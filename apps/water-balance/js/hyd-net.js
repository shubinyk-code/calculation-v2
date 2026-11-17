/*
    Сеть участков для расчёта: из графа холста строится дерево труб.

    Лист ХВС обходится от ввода, лист ГВС — от ИТП. Горячая сеть растёт из
    питающей трубы ИТП холодной сети, так что путь от насоса до любого прибора
    ГВС — одна цепочка parent (ввод → … → насос → … → ИТП → … → прибор).

    Каналы расхода (СП 30, разд. 5), по составу нагрузки ниже участка:
      нет ИТП ниже           → холодный (cold);
      ИТП и прочая нагрузка  → общий (total) — холодная вода плюс подпитка ГВС;
      только ИТП (подача)    → горячий (hot);
      лист ГВС               → горячий (hot).
    Если на холсте ИТП нет вовсе, горячая вода берётся не из здания, и вся
    нагрузка считается общим каналом.

    Системы — насосные установки: поддерево за насосом. Прибор, до которого
    насоса нет по пути, питается от городской сети.
*/

var HydNet = (function () {
    'use strict';

    function normOf(name) {
        return Tables.norm(name) || Tables.norm(HydModel.LIVING);
    }

    /* Группа нагрузки выхода (квартиры) в зависимости от способа расчёта. */
    function outletGroup(it, method) {
        var norm = normOf(it.riser.norm);
        var U = it.people;
        var N = U;
        var Nh = U;
        var noHot = !(norm.qhruh > 0);

        if (method === 'fixtures' && it.N > 0) {
            N = it.N;
            Nh = it.Nh;
            if (Nh === 0) noHot = true;
        }

        return { norm: norm, U: U, N: N, Nh: Nh, noHot: noHot, kind: 'outlet', ref: it };
    }

    function buildInGroup(b, method) {
        var norm = normOf(b.norm);
        var U = b.U;
        var N = b.N > 0 ? b.N : U;
        var Nh = b.Nh > 0 ? b.Nh : N;

        if (method !== 'fixtures') { N = U; Nh = U; }

        return {
            norm: norm, U: U, N: N, Nh: Nh,
            noHot: !b.hasHot || !(norm.qhruh > 0),
            kind: 'buildin', ref: b
        };
    }

    function union(a, b) {
        var set = new Set(a);
        b.forEach(function (g) { set.add(g); });
        return Array.from(set);
    }

    function nodeLabel(n, marks, net) {
        if (n.kind === 'input') return n.name;
        if (n.kind === 'pump') return 'насос ' + n.name;
        if (n.kind === 'itp') return n.name || 'ИТП';
        if (n.kind === 'meter') return 'счётчик';
        if (n.kind === 'tee') return 'узел';
        if (n.kind === 'buildin') return n.name;
        if (n.kind === 'riser') return 'Ст.' + (marks[n.id] ? marks[n.id][net] : n.id);
        return n.id;
    }

    /*
        Построение. Возвращает { segs, byId, leaves, systems, warnings, marks }.
        ex — результат HydModel.expand().
    */
    function build(hyd, ex) {
        var survey = hyd.survey;
        var method = hyd.method;
        var scale = survey.scale;
        var nodes = hyd.canvas.nodes;
        var warnings = [];
        var segs = [];
        var byId = {};
        var leaves = [];

        var marks = {};
        var riserEntry = {};

        ex.risers.forEach(function (r) {
            marks[r.node.id] = { c: r.markC, h: r.markH };
            riserEntry[r.node.id] = r;
            r.floors.forEach(function (fl) {
                fl.collectors.forEach(function (c) { c.outlets.forEach(function (it) { it.group = outletGroup(it, method); }); });
            });
        });

        var result = { segs: segs, byId: byId, leaves: leaves, systems: [], warnings: warnings, marks: marks };

        var inputs = nodes.filter(function (n) { return n.kind === 'input'; });
        var itps = nodes.filter(function (n) { return n.kind === 'itp'; });

        if (!inputs.length) {
            warnings.push('На листе ХВС нет ввода: поставьте «Ввод» и соедините его трубами со стояками.');
            return result;
        }

        if (inputs.length > 1) warnings.push('Ввод нарисован не один: расчёт идёт от первого («' + inputs[0].name + '»).');

        var root = inputs[0];

        /* --- нагрузка узла ------------------------------------------------- */

        var buildGroups = {};

        nodes.forEach(function (n) { if (n.kind === 'buildin' && n.U > 0) buildGroups[n.id] = buildInGroup(n, method); });

        function ownLoad(n, hot) {
            var list = [];

            if (n.kind === 'buildin' && buildGroups[n.id]) {
                list.push(buildGroups[n.id]);
            } else if (n.kind === 'riser' && riserEntry[n.id]) {
                riserEntry[n.id].floors.forEach(function (fl) {
                    fl.collectors.forEach(function (c) { c.outlets.forEach(function (it) { list.push(it.group); }); });
                });
            }

            return hot ? list.filter(function (g) { return !g.noHot; }) : list;
        }

        /* Нагрузка поддерева каждого узла: обход в обратном порядке. */
        function subtree(t, hot) {
            var loads = {};
            for (var i = t.order.length - 1; i >= 0; i--) {
                var id = t.order[i];
                var n = HydModel.nodeById(hyd, id);
                loads[id] = (loads[id] || []).concat(ownLoad(n, hot));
                if (t.parent[id]) loads[t.parent[id].p] = (loads[t.parent[id].p] || []).concat(loads[id]);
            }
            return loads;
        }

        /* --- горячая сторона: что обслуживает каждая ИТП ------------------- */

        var hotTree = GraphHot();
        var served = {};
        var hotLoads = hotTree.loads;

        function GraphHot() {
            var t = HydGraph.tree(hyd, 'h', itps.map(function (n) { return n.id; }));
            return { t: t, loads: subtree(t, true) };
        }

        itps.forEach(function (i) { served[i.id] = hotLoads[i.id] || []; });

        if (hotTree.t.cycles) warnings.push('На листе ГВС есть замкнутые контуры (' + hotTree.t.cycles + '): кольцевые сети не поддерживаются, считается по первой найденной ветке.');

        /* --- холодное дерево ----------------------------------------------- */

        var cold = HydGraph.tree(hyd, 'c', [root.id]);
        if (cold.cycles) warnings.push('На листе ХВС есть замкнутые контуры (' + cold.cycles + '): кольцевые сети не поддерживаются, считается по первой найденной ветке.');

        var coldLoads = subtree(cold, false);
        var itpBelow = {};

        for (var oi = cold.order.length - 1; oi >= 0; oi--) {
            var cid0 = cold.order[oi];
            var n0 = HydModel.nodeById(hyd, cid0);
            itpBelow[cid0] = (itpBelow[cid0] || []).concat(n0.kind === 'itp' ? [n0] : []);
            if (cold.parent[cid0]) itpBelow[cold.parent[cid0].p] = (itpBelow[cold.parent[cid0].p] || []).concat(itpBelow[cid0]);
        }

        var plainCold = !itps.length;

        function coldFlow(id) {
            var C = coldLoads[id] || [];
            var I = itpBelow[id] || [];

            if (!I.length) return { ch: plainCold ? 'total' : 'cold', groups: C };

            var H = [];
            I.forEach(function (i) { H = union(H, served[i.id] || []); });

            if (!C.length) return { ch: 'hot', groups: H };
            return { ch: 'total', groups: union(C, H) };
        }

        function add(seg) {
            seg.children = [];
            seg.leaf = !!seg.leaf;
            segs.push(seg);
            byId[seg.id] = seg;
            if (seg.parent && byId[seg.parent]) byId[seg.parent].children.push(seg.id);
            return seg;
        }

        function pipeLen(pipe) { return HydGraph.polyLen(HydGraph.ptsOf(hyd, pipe)) * scale; }

        var out = { c: {}, h: {} };     // сегмент, из которого дальше течёт вода после узла

        /* --- обход листа: общая часть для ХВС и ГВС ------------------------ */

        function walk(net, t, rootId, rootSeg) {
            out[net][rootId] = rootSeg;

            t.order.forEach(function (id) {
                if (id === rootId) return;

                var n = HydModel.nodeById(hyd, id);
                var par = t.parent[id];
                var parentNode = HydModel.nodeById(hyd, par.p);
                var parentSeg = out[net][par.p];
                var cnet = net === 'c';
                var cf = cnet ? coldFlow(id) : { ch: 'hot', groups: hotLoads[id] || [] };

                var ps = add({
                    id: net + '|' + par.pipe.id, net: net, cls: 'mains', kind: 'pipe', pipe: 'mains',
                    name: nodeLabel(parentNode, marks, net) + ' → ' + nodeLabel(n, marks, net),
                    parent: parentSeg.id, ch: cf.ch, groups: cf.groups, L: pipeLen(par.pipe), node: id,
                    meta: { pipe: par.pipe.id, to: id }
                });

                out[net][id] = ps;

                if (n.kind === 'meter' || (n.kind === 'pump' && cnet)) {
                    out[net][id] = add({
                        id: net + '|dev:' + id, net: net, cls: 'device', kind: 'device', dev: n.kind, pipe: 'mains',
                        name: n.kind === 'meter' ? 'Водомерный узел' : 'Насосная установка ' + n.name,
                        parent: ps.id, ch: cf.ch, groups: cf.groups, L: 0, node: id,
                        meter: n.kind === 'meter' ? n.role : null, meta: { node: id }
                    });
                } else if (n.kind === 'itp' && cnet) {
                    ps.meta.itp = id;
                } else if (n.kind === 'buildin') {
                    var g = buildGroups[id];

                    if (!g) return;

                    ps.leaf = true;
                    ps.groups = cnet ? [g] : (g.noHot ? [] : [g]);
                    if (cnet) ps.ch = g.noHot || plainCold ? 'total' : 'cold';
                    leaves.push({ net: net, seg: ps.id, elev: n.elev + 1.2, label: n.name, node: id });
                } else if (n.kind === 'riser') {
                    riser(net, n, ps);
                }
            });
        }

        walk('c', cold, root.id, add({
            id: 'c|in', net: 'c', cls: 'input', kind: 'input', pipe: 'mains', name: root.name,
            parent: '', ch: coldFlow(root.id).ch, groups: coldFlow(root.id).groups, L: root.length, node: root.id,
            meta: { node: root.id }
        }));

        /* Лист ГВС: корнем служит ИТП, подключённая к холодной подаче. */
        itps.forEach(function (itp) {
            if (!cold.reached[itp.id]) {
                warnings.push(itp.name + ' не соединён трубой с вводом на листе ХВС.');
                return;
            }

            var t = hotTree.t;
            if (!(t.children[itp.id] || []).length) {
                warnings.push(itp.name + ': на листе ГВС от него не отходит ни одной трубы.');
                return;
            }

            var feed = out.c[itp.id];

            var dev = add({
                id: 'h|dev:' + itp.id, net: 'h', cls: 'device', kind: 'itpdev', dev: 'itp', pipe: 'mains',
                name: itp.name || 'ИТП', parent: feed.id, ch: 'hot', groups: served[itp.id] || [], L: 0, node: itp.id,
                meta: { node: itp.id }
            });

            // обход листа ГВС только поддерева этой ИТП
            var sub = { order: [], parent: t.parent, children: t.children, reached: t.reached };
            var q = [itp.id];
            for (var k = 0; k < q.length; k++) {
                sub.order.push(q[k]);
                (t.children[q[k]] || []).forEach(function (c) { q.push(c); });
            }

            walk('h', sub, itp.id, dev);
        });

        /* --- стояк: цепочка по этажам, один диаметр ------------------------- */

        function riser(net, node, arrival) {
            var cnet = net === 'c';
            var entry = riserEntry[node.id];
            var survey2 = hyd.survey;
            var mark = marks[node.id][net];
            var top = node.floorTo;
            var lvl = HydModel.levels(hyd, node);
            var chain = net + '|R:' + node.id;
            var chCold = plainCold ? 'total' : 'cold';
            var ch = cnet ? chCold : 'hot';

            var byFloor = {};
            entry.floors.forEach(function (fl) { byFloor[fl.f] = fl; });

            var above = {};
            var running = [];

            for (var f = top; f >= 1; f--) {
                if (byFloor[f]) {
                    byFloor[f].collectors.forEach(function (c) {
                        c.outlets.forEach(function (it) { if (cnet || !it.group.noHot) running.push(it.group); });
                    });
                }
                above[f] = running.slice();
            }

            var prev = arrival;
            var firstId = '';

            for (var k = 1; k <= top; k++) {
                if (!above[k].length) break;

                var elevLow = k === 1 ? node.baseElev : lvl[k - 1];
                var elevHigh = lvl[k];
                var L = Math.max(0, elevHigh - elevLow);
                var rid = net + '|' + node.id + '|R|' + k;
                if (!firstId) firstId = rid;

                var rs = add({
                    id: rid, net: net, cls: 'riser', kind: 'riser', pipe: 'risers', name: 'Ст.' + mark,
                    parent: prev.id, ch: ch, groups: above[k], L: L, chain: chain, sizeKey: firstId,
                    meta: { riser: node.id, mark: mark, floor: k, elevLow: elevLow, elevHigh: elevHigh }
                });

                prev = rs;

                if (!byFloor[k]) continue;

                byFloor[k].collectors.forEach(function (c) {
                    var outs = c.outlets.filter(function (it) { return cnet || !it.group.noHot; });
                    if (!outs.length) return;

                    var fb = add({
                        id: net + '|' + c.id + '|fb', net: net, cls: 'riser', kind: 'fbranch', pipe: 'risers',
                        name: c.col.name, parent: rs.id, ch: ch, groups: outs.map(function (it) { return it.group; }),
                        L: c.col.branchLen,
                        meta: { riser: node.id, mark: mark, floor: k, collector: c.id, elev: elevHigh, collElev: elevHigh + c.col.elev }
                    });

                    outs.forEach(function (it) {
                        var vertical = Math.abs(it.outlet.fixtureElev - c.col.elev);
                        var os = add({
                            id: net + '|' + it.id, net: net, cls: 'apartment', kind: 'outlet', pipe: 'apartment',
                            name: it.label, parent: fb.id, ch: ch, groups: [it.group], L: it.outlet.lenM + vertical, leaf: true,
                            meter: survey2.apartmentMeter && it.outlet.meter ? 'apt' : null,
                            meta: { riser: node.id, floor: k, collector: c.id, outlet: it.id, elev: elevHigh + it.outlet.fixtureElev, item: it }
                        });

                        leaves.push({ net: net, seg: os.id, elev: os.meta.elev, label: it.label, riser: node.id, floor: k });
                    });
                });
            }
        }

        /* --- несвязанные объекты ------------------------------------------- */

        // тупики с лишними трубами: стояк, встроенное помещение, ИТП на листе ХВС
        nodes.forEach(function (n) {
            ['c', 'h'].forEach(function (sheet) {
                if (!HydGraph.onSheet(n, sheet)) return;
                var deg = HydGraph.degreeOn(hyd, n.id, sheet);
                if (deg <= HydGraph.limit(n, sheet)) return;
                var what = n.kind === 'itp' ? 'ИТП' : (n.kind === 'riser' ? 'Стояк ' + marks[n.id][sheet] : n.name);
                warnings.push(what + ': на листе ' + (sheet === 'c' ? 'ХВС' : 'ГВС') + ' подведено труб: ' + deg + ', а должна быть одна'
                    + (n.kind === 'itp' ? ' (подача). Горячую сеть рисуйте на листе ГВС.' : ' — объект тупиковый, лишняя труба замыкает кольцо.'));
            });
        });


        nodes.forEach(function (n) {
            if (n.kind === 'riser' && riserEntry[n.id] && riserEntry[n.id].top > 0) {
                var has = ownLoad(n, false).length;
                if (has && !cold.reached[n.id]) warnings.push('Стояк ' + marks[n.id].c + ' не соединён трубой с вводом на листе ХВС.');
                else if (has && itps.length && ownLoad(n, true).length && !hotTree.t.reached[n.id]) warnings.push('Стояк ' + marks[n.id].h + ' не соединён с ИТП на листе ГВС.');
                if (!has) warnings.push('У стояка ' + marks[n.id].c + ' нет выходов: проверьте типы этажей и диапазоны.');
            }
            if (n.kind === 'buildin' && n.U > 0 && !cold.reached[n.id]) warnings.push(n.name + ' не соединено трубой с вводом на листе ХВС.');
        });

        /* --- системы: насос выше по цепочке ------------------------------- */

        var sysMemo = {};

        function sysOf(seg) {
            if (sysMemo[seg.id] !== undefined) return sysMemo[seg.id];
            var r = '';
            if (seg.dev === 'pump' && seg.net === 'c') r = seg.node;
            else if (seg.parent) r = sysOf(byId[seg.parent]);
            sysMemo[seg.id] = r;
            return r;
        }

        segs.forEach(function (s) { s.sys = sysOf(s); });

        var systems = {};
        var sysOrder = [];

        leaves.forEach(function (lf) {
            var id = byId[lf.seg].sys || 'city';
            if (!systems[id]) {
                var pn = id === 'city' ? null : HydModel.nodeById(hyd, id);
                systems[id] = {
                    id: id, kind: pn ? 'pump' : 'city', node: pn,
                    name: pn ? pn.name : 'Городская сеть', leaves: [], groups: []
                };
                sysOrder.push(id);
            }
            systems[id].leaves.push(lf);
            lf.sys = id;
        });

        // порядок: по порядку насосов на холсте
        nodes.forEach(function (n) { if (n.kind === 'pump' && systems[n.id]) result.systems.push(systems[n.id]); });
        if (systems.city) result.systems.push(systems.city);

        result.systems.forEach(function (sys) {
            var set = new Set();
            sys.leaves.forEach(function (lf) { byId[lf.seg].groups.forEach(function (g) { set.add(g); }); });
            sys.groups = Array.from(set);
            sys.segs = sys.id === 'city' ? segs.filter(function (s) { return s.sys === ''; }) : segs.filter(function (s) { return s.sys === sys.id; });
        });

        result.reached = { c: cold.reached, h: hotTree.t.reached };
        result.pipeIssue = {};
        hyd.canvas.pipes.forEach(function (p) {
            if (byId[p.sheet + '|' + p.id]) return;
            var t = p.sheet === 'c' ? cold : hotTree.t;
            var issue = t.reached[p.a] && t.reached[p.b] ? 'ring' : 'free';

            // Труба входит в дерево обхода (не кольцо), но участка из неё не вышло: расчёт её пропустил.
            var onTree = (t.parent[p.a] && t.parent[p.a].pipe === p) || (t.parent[p.b] && t.parent[p.b].pipe === p);

            if (onTree) {
                issue = 'skipped';

                if (p.sheet === 'h') {
                    // подняться по дереву ГВС до ИТП, которой принадлежит труба
                    var at = t.parent[p.a] && t.parent[p.a].pipe === p ? p.a : p.b;
                    for (var guard = 0; t.parent[at] && guard < 1000; guard++) at = t.parent[at].p;
                    if (!cold.reached[at]) issue = 'itp-cold';
                }
            }

            result.pipeIssue[p.sheet + '|' + p.id] = issue;
        });

        return result;
    }

    return { build: build };
})();
