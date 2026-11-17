'use strict';

/*
    Таблица расчёта и итог по системе — то, что в калькуляторе Excel
    живёт на листах «Расчет» и «Вывод данных».

    Сеть разбирается на группы:

      основная ветвь — путь от диктующего оросителя до ввода. Её участки
                       нумеруются как основные (по умолчанию 1-2, 2-3, …);
      лучи           — всё, что отходит от основной ветви. Каждый луч
                       считается от своего самого удалённого оросителя до
                       узла присоединения и нумеруется как второстепенный
                       (а-б, б-в, …). Луч на луче — вложенная группа.

    Режим «как в СП» повторяет Excel: луч маршируется от напора диктующего
    оросителя, а затем приводится к узлу строкой Q = Qк·√(Hуз/Hк). В режиме
    «фактические напоры» каждая строка показывает настоящий напор и расход.
    Числа в двух режимах связаны точно: при однородной сети марш от Hдикт —
    это фактические напоры, умноженные на β = Hдикт/Hфакт, и расходы,
    умноженные на √β.
*/

var Calc = (function () {

    var RU = 'абвгдежзиклмнопрстуфхцчшщэюя';
    var LAT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    function alphabet(letters, index) {
        var n = letters.length;
        if (index < n) return letters.charAt(index);
        return alphabet(letters, Math.floor(index / n) - 1) + letters.charAt(index % n);
    }

    var STYLES = [
        { key: 'digits',        name: '1, 2, 3' },
        { key: 'letters',       name: 'а, б, в' },
        { key: 'latin',         name: 'A, B, C' },
        { key: 'digits-suffix', name: '1а, 2а … 1б, 2б (суффикс луча)' },
        { key: 'dotted',        name: '1.1, 1.2 … 2.1 (номер луча)' },
        { key: 'after-main',    name: 'цифры после основной ветви' }
    ];

    /**
     * Метка по стилю. index — порядковый номер внутри последовательности
     * (с нуля), group — номер луча (с нуля) для стилей с суффиксом.
     */
    function sequenceLabel(style, start, index, group) {
        var base = (start > 0 ? start : 1) - 1;

        switch (style) {
            case 'letters': return alphabet(RU, base + index);
            case 'latin': return alphabet(LAT, base + index);
            case 'digits-suffix': return String(base + 1 + index) + alphabet(RU, group);
            case 'dotted': return String(group + 1) + '.' + String(base + 1 + index);
            default: return String(base + 1 + index);
        }
    }

    /** Сквозные стили продолжают счёт через все лучи, остальные начинают заново. */
    function continuous(style) {
        return style === 'digits' || style === 'letters' || style === 'latin' || style === 'after-main';
    }

    /* --- группы ----------------------------------------------------------- */

    function buildGroups(project, net) {
        var groups = [];
        var hreq = project.settings.dictHead;

        var main = {
            index: 0,
            kind: 'main',
            path: net.path.slice(),
            attach: null,
            parent: null,
            beta: 1,
            depth: 0,
            children: []
        };
        groups.push(main);

        function subtreeCritical(root) {
            // Самый «голодный» ороситель поддерева — с наименьшим фактическим
            // напором. От него луч и маршируется.
            var best = null;
            var stack = [root];

            while (stack.length) {
                var id = stack.pop();
                var info = net.N[id];

                if (info.working && (best === null || info.H < net.N[best].H - 1e-12)) best = id;
                info.children.forEach(function (c) {
                    if (net.N[c].active) stack.push(c);
                });
            }

            if (best !== null) return best;

            // Одни постоянные расходы — берётся самый удалённый такой узел.
            stack = [root];
            while (stack.length) {
                var at = stack.pop();
                if (net.N[at].fixed > 0 && (best === null || net.N[at].depth > net.N[best].depth)) best = at;
                net.N[at].children.forEach(function (c) {
                    if (net.N[c].active) stack.push(c);
                });
            }

            return best;
        }

        function branchesOf(group) {
            var onPath = {};
            group.path.forEach(function (id) { onPath[id] = true; });

            var last = group.kind === 'main' ? group.path.length : group.path.length - 1;

            for (var i = 0; i < last; i++) {
                var nodeId = group.path[i];

                net.N[nodeId].children.forEach(function (c) {
                    if (onPath[c] || !net.N[c].active) return;

                    var crit = subtreeCritical(c);
                    if (crit === null) return;

                    var path = [];
                    for (var at = crit; at !== nodeId; at = net.N[at].parent) path.push(at);
                    path.push(nodeId);

                    var working = net.N[crit].working;
                    var g = {
                        index: groups.length,
                        kind: 'branch',
                        path: path,
                        attach: nodeId,
                        parent: group,
                        beta: working ? hreq / net.N[crit].H : 1,
                        depth: group.depth + 1,
                        children: []
                    };

                    groups.push(g);
                    group.children.push(g);
                    branchesOf(g);
                });
            }
        }

        branchesOf(main);
        return groups;
    }

    /* --- нумерация -------------------------------------------------------- */

    function numberGroups(project, groups) {
        var num = project.settings.num;
        var byId = {};
        project.nodes.forEach(function (n) { byId[n.id] = n; });

        var nodeLabels = {};
        var mainCount = 0;
        var branchCounter = 0;
        var branchIndex = 0;

        function remember(id, label) {
            if (!nodeLabels[id]) nodeLabels[id] = [];
            if (nodeLabels[id].indexOf(label) < 0) nodeLabels[id].push(label);
        }

        groups.forEach(function (g) {
            g.labels = {};
            var isMain = g.kind === 'main';
            var style = isMain ? num.mainStyle : num.branchStyle;
            var start = isMain ? num.mainStart : num.branchStart;
            var prefix = isMain ? num.mainPrefix : num.branchPrefix;
            var suffix = isMain ? num.mainSuffix : num.branchSuffix;

            if (!isMain && style === 'after-main') start = mainCount + 1;

            // Узлы, получающие метку из последовательности.
            var sequence = [];
            var fixedLabels = {};

            g.path.forEach(function (id, i) {
                var n = byId[id];
                var isAttach = !isMain && i === g.path.length - 1;

                if (isAttach && num.attach !== 'own') {
                    fixedLabels[id] = g.parent.labels[id];
                    return;
                }
                if (n.label) {
                    fixedLabels[id] = n.label;
                    sequence.push(id);
                    return;
                }
                if (isMain && n.src && num.sourceLabel) {
                    fixedLabels[id] = num.sourceLabel;
                    return;
                }
                if (isMain && n.cu && num.cuLabel) {
                    fixedLabels[id] = num.cuLabel;
                    return;
                }
                sequence.push(id);
            });

            if (num.direction === 'source') sequence.reverse();

            var counterStart = isMain || !continuous(style) ? 0 : branchCounter;

            sequence.forEach(function (id, i) {
                if (fixedLabels[id]) return;
                g.labels[id] = prefix + sequenceLabel(style, start, counterStart + i, branchIndex) + suffix;
            });

            Object.keys(fixedLabels).forEach(function (id) {
                g.labels[id] = fixedLabels[id];
            });

            if (isMain) {
                mainCount = sequence.length;
            } else {
                if (continuous(style)) branchCounter += sequence.length;
                branchIndex++;
            }

            g.path.forEach(function (id) {
                if (g.labels[id]) remember(id, g.labels[id]);
            });

            g.name = g.labels[g.path[0]] + '–' + g.labels[g.path[g.path.length - 1]];
        });

        return nodeLabels;
    }

    /* --- аналоги ---------------------------------------------------------- */

    /**
     * Подпись луча для поиска аналогов: длины, Kт, оросители и вложенные лучи
     * по порядку. Одинаковая подпись — луч гидравлически тот же, и в таблице
     * он помечается «аналог луча …», как это принято в расчётах по СП.
     */
    function pathSignature(net, path, children) {
        var parts = [];
        for (var i = 0; i + 1 < path.length; i++) {
            var info = net.N[path[i]];
            var seg = net.S[info.pseg];
            parts.push([
                seg.L.toFixed(2), seg.kt.toFixed(3), seg.m,
                info.working ? info.k : 0, info.fixed
            ].join(':'));
        }
        children.forEach(function (c) {
            parts.push('[' + pathSignature(net, c.path, c.children) + ']');
        });
        return parts.join('|');
    }

    /**
     * Копия диктующего луча сравнивается не с лучами, а с началом основной
     * ветви той же длины: диктующий луч — это первые участки основной ветви,
     * и где он кончается, решает только число участков, а не узел, к которому
     * присоединена копия.
     */
    function findAnalogs(net, groups) {
        var main = groups[0];
        var seen = [];

        groups.forEach(function (g) {
            if (g.kind !== 'branch') return;

            g.signature = pathSignature(net, g.path, g.children);

            var j = g.path.length - 1;
            if (j > 0 && j < main.path.length) {
                var before = main.children.filter(function (c) {
                    return main.path.indexOf(c.attach) < j;
                });
                if (pathSignature(net, main.path.slice(0, j + 1), before) === g.signature) {
                    g.analogOf = { name: main.labels[main.path[0]] + '–' + main.labels[main.path[j]] };
                    return;
                }
            }

            for (var i = 0; i < seen.length; i++) {
                if (seen[i].signature === g.signature && seen[i].depth === g.depth) {
                    g.analogOf = seen[i];
                    return;
                }
            }
            seen.push(g);
        });
    }

    /* --- строки таблицы ---------------------------------------------------- */

    function buildRows(project, net, groups) {
        var s = project.settings;
        var byPlan = s.planKind === 'vpv';
        // Приведение луча к узлу — приём расчёта оросителей: у кранов расход
        // задан, приводить нечего, поэтому таблица идёт фактическими напорами.
        var sp = s.tableMode !== 'actual' && !byPlan;
        var rows = [];
        var byId = {};
        project.nodes.forEach(function (n) { byId[n.id] = n; });
        var segById = {};
        project.segments.forEach(function (x) { segById[x.id] = x; });

        groups.forEach(function (g) {
            var beta = sp ? g.beta : 1;
            var root = Math.sqrt(beta);
            var collapsed = g.analogOf && s.collapseAnalogs;

            var title;
            if (g.kind === 'main') {
                // На плане внутреннего пожаротушения марш идёт от крана.
                title = 'Основная ветвь ' + g.name + ' — от диктующего '
                    + (s.planKind === 'vpv' ? 'пожарного крана' : 'оросителя') + ' до ввода';
            } else {
                title = 'Луч ' + g.name + ' — к узлу ' + g.parent.labels[g.attach];
                if (g.analogOf) title += ' · аналог луча ' + g.analogOf.name;
            }

            rows.push({ type: 'group', group: g, text: title });

            var sumLoss = 0;

            for (var i = 0; i + 1 < g.path.length; i++) {
                var id = g.path[i];
                var info = net.N[id];
                var seg = net.S[info.pseg];
                var model = segById[info.pseg];
                var n = byId[id];

                sumLoss += seg.dH * beta;

                if (collapsed) continue;

                rows.push({
                    type: 'seg',
                    group: g,
                    segId: info.pseg,
                    nodeId: id,
                    name: g.labels[id] + '-' + g.labels[g.path[i + 1]],
                    H: info.H * beta,
                    // На плане кранов в тех же столбцах стоят λ и Re: потери
                    // считаются по Дарси–Вейсбаху, а не через Kт.
                    kt: byPlan ? seg.lambda : seg.kt,
                    ktSource: byPlan ? 'shevelev' : seg.ktSource,
                    k: byPlan ? seg.Re : n.spr ? info.k : null,
                    working: info.working,
                    fixed: info.fixed,
                    Q: seg.Q * root,
                    dn: seg.dn,
                    od: model.od,
                    wall: model.wall,
                    material: model.material,
                    // Скорость по расчётному диаметру: труба не новая.
                    V: byPlan ? seg.V : Solver.velocity(seg.Q * root, seg.dIn),
                    Vactual: seg.V,
                    L: seg.L,
                    lenManual: model.len > 0,
                    ktManual: model.kt > 0,
                    ring: model.ring,
                    dH: seg.dH * beta
                });
            }

            if (g.kind === 'main') {
                rows.push({
                    type: 'total',
                    group: g,
                    name: 'Итого',
                    H: net.Hsource,
                    Q: net.Qtotal,
                    dH: sumLoss
                });
                return;
            }

            var last = net.N[g.path[g.path.length - 2]];
            var lastSeg = net.S[last.pseg];
            var parentBeta = sp ? g.parent.beta : 1;
            var Hk = net.N[g.attach].H * beta;
            var Hnode = net.N[g.attach].H * parentBeta;
            // В узел приходит расход всего поддерева луча, а не половина
            // на участке-полукольце.
            var Qk = lastSeg.Qsub * root;
            var Q = Qk * Math.sqrt(Hnode / Hk);

            rows.push({
                type: 'summary',
                group: g,
                name: '→ ' + g.parent.labels[g.attach],
                Hk: Hk,
                Hnode: Hnode,
                Qk: Qk,
                Q: Q,
                sp: sp
            });
        });

        return rows;
    }

    /* --- итог по системе --------------------------------------------------- */

    function systemHead(project, net) {
        var s = project.settings;
        var xi = s.cuXi > 0 ? s.cuXi : Catalog.cuXi(s.cuKind, s.cuDn);
        var Q = net.Qtotal;

        // Внутреннее пожаротушение по плану идёт без узла управления: в
        // требуемом напоре вместо Нуу стоит давление у пожарного крана.
        var byPlan = s.planKind === 'vpv';

        var head = {
            Q: Q,
            Hgeom: Model.planeElev(s) - s.inletElev,
            HnetRaw: net.HnetRaw,
            localFactor: s.localFactor,
            Hnet: net.HnetRaw * s.localFactor,
            xi: xi,
            xiFromTable: !(s.cuXi > 0),
            Hcu: byPlan ? 0 : 1000 * xi * (Q * 3.6) * (Q * 3.6),
            // Напор в диктующей точке: у оросителя это Hдикт, у крана — давление
            // у клапана, приведённое к отметке оросителей.
            Hfree: net.Hdict,
            dictKind: net.dictKind,
            dictName: '',
            Hpump: s.pumpLoss,
            Hsuction: s.suction,
            Hguar: s.guaranteed
        };

        var dictNode = Model.node(project, net.dict);
        if (dictNode && dictNode.pk && net.dictKind === 'pk') {
            var hy = Model.hydrant(project, dictNode);
            head.dictName = Model.hydrantName(project, dictNode);
            head.pkHead = hy.head;
            head.pkElev = hy.elev;
        }

        head.Hreq = head.Hgeom + head.Hpump + head.Hnet + head.Hcu + head.Hfree + head.Hsuction;
        head.HpumpReq = head.Hreq - head.Hguar;
        return head;
    }

    function checks(project, net) {
        var s = project.settings;
        var working = 0;
        project.nodes.forEach(function (n) {
            if (net.N[n.id] && net.N[n.id].working) working++;
        });

        var qi = s.intensity * s.spacing * s.spacing;
        var q = s.k * Math.sqrt(s.dictHead);

        return {
            qi: qi,
            q: q,
            f: q > 0 ? qi / q : 0,
            working: working,
            zoneArea: Model.hasZone(project) ? Model.polygonArea(project.zone) : 0,
            covered: working * s.spacing * s.spacing,
            normArea: s.area,
            normFlow: s.intensity * s.area
        };
    }

    /* --- пожарные краны и тип системы ------------------------------------------ */

    function hydrants(project, net) {
        var s = project.settings;
        var list = [];

        project.nodes.forEach(function (n) {
            if (!n.pk) return;

            var info = net.N[n.id];
            // На плане внутреннего пожаротушения струи крану раздал расчёт.
            var h = Model.hydrant(project, n, s.planKind === 'vpv' ? (info ? info.pkJets : 0) : undefined);
            var reach = !!(info && info.reach);
            var item = {
                id: n.id,
                name: Model.hydrantName(project, n),
                jets: h.jets,
                flow: h.flow,
                Q: h.Q,
                head: h.head,
                elev: h.elev,
                reach: reach,
                working: h.jets > 0,
                // Признак «в расчётном случае», как его поставил человек.
                use: n.pk.use === true ? true : n.pk.use === false ? false : n.pk.jets > 0 ? true : null,
                H: reach ? info.H : 0,
                valve: reach ? info.H + (Model.planeElev(s) - h.elev) : 0,
                dict: net.dict === n.id,
                supplyDn: null
            };

            // Труба, к которой присоединена подводка крана: сам узел, если он
            // стоит прямо на трубе, иначе первая развилка по пути к вводу.
            if (reach) {
                var at = n.id;
                while (true) {
                    var here = net.N[at];
                    var through = Model.segmentsAt(project, at).length >= (at === n.id ? 2 : 3);
                    if (through && here.pseg !== null) {
                        var seg = net.S[here.pseg];
                        item.supplyDn = seg.dn || Math.round(seg.dIn);
                        break;
                    }
                    if (here.parent === null) break;
                    at = here.parent;
                }
            }

            list.push(item);
        });

        return list;
    }

    /**
     * Воздухозаполненная установка (СП 485 п. 6.2). Гидравлика та же, но
     * добавляются проверки: воздушный узел управления, положение розеток при
     * температуре ниже 5 °C (п. 6.2.19), краны на воздухозаполненной части
     * (п. 6.7.1.45) и объём воздухозаполненных трубопроводов — от него зависит
     * инерционность, которая не должна превышать 180 с (п. 6.2.4).
     */
    function airCheck(project, net, warnings, pkList) {
        var s = project.settings;
        var vpv = s.planKind === 'vpv';
        var result = { on: s.systemKind === 'воздухозаполненная', volume: 0, hasCu: false, fill: 0, limit: 0 };
        if (!result.on) return result;

        var cu = {};
        project.nodes.forEach(function (n) {
            if (n.cu && net.N[n.id] && net.N[n.id].reach) {
                cu[n.id] = true;
                result.hasCu = true;
            }
        });

        // Воздухом заполнено всё, что за узлом управления.
        var below = {};
        net.order.forEach(function (id) {
            var parent = net.N[id].parent;
            below[id] = parent !== null && (!!cu[parent] || !!below[parent]);
        });

        project.segments.forEach(function (seg) {
            var info = net.S[seg.id];
            if (!info || !info.inTree) return;
            if (result.hasCu && !cu[info.up] && !below[info.up]) return;
            result.volume += Math.PI * Math.pow(info.dIn / 1000, 2) / 4 * info.L;
        });

        /*
            Воздушный внутренний противопожарный водопровод: по п. 8.4
            СП 10.13130.2020 к запорному устройству присоединяют столько ПК,
            чтобы незаполненные водой трубопроводы вмещали не больше 1 м³, а
            вода в диктующий кран приходила не позже 30 с. Время считаем по
            расходу диктующего крана — им сеть и заполняется.
        */
        if (vpv) {
            result.limit = 1;
            // Заполняется сеть расчётным расходом системы — тем, что даёт насос.
            var fillQ = net.Qtotal;
            result.fill = fillQ > 0 ? result.volume * 1000 / fillQ : 0;

            if (result.volume > result.limit + 1e-9) {
                warnings.push('Объём незаполненных водой трубопроводов ' + Fmt.num(result.volume * 1000, 0)
                    + ' л — больше 1 м³ (п. 8.4 СП 10.13130.2020). Разделите сеть на тупиковые ветки запорными устройствами.');
            }
            if (result.fill > 30 + 1e-9) {
                warnings.push('Вода придёт в диктующий ПК за ' + Fmt.num(result.fill, 0)
                    + ' с — больше 30 с (п. 8.4 СП 10.13130.2020).');
            }
            return result;
        }

        if (s.cuKind !== 'Воздушный') {
            warnings.push('Система воздухозаполненная, а узел управления «' + s.cuKind + '» — выберите воздушный.');
        }
        if (!result.hasCu) {
            warnings.push('Узел управления на схеме не поставлен — воздухозаполненной считается вся сеть.');
        }

        if (s.coldRoom) {
            var main = Sprinklers.find(s.maker, s.sprinklerType);
            var down = [];
            project.nodes.forEach(function (n) {
                if (!n.spr) return;
                var item = n.model ? Sprinklers.findKey(n.model) : main;
                if (item && item.orient === 'вниз' && down.indexOf(item.model) < 0) down.push(item.model);
            });
            if (down.length) {
                warnings.push('При температуре ниже 5 °C в воздухозаполненной установке оросители ставят только розеткой вверх '
                    + 'или горизонтально (СП 485 п. 6.2.19). Сейчас розеткой вниз: ' + down.join(', ') + '.');
            }
        }

        pkList.forEach(function (k) {
            if (k.reach && (!result.hasCu || below[k.id])) {
                warnings.push(k.name + ' стоит на воздухозаполненной части сети: нужно выполнить требования СП 10.13130 '
                    + 'ко времени подачи воды (СП 485 п. 6.7.1.45).');
            }
        });

        return result;
    }

    /* --- сборка ------------------------------------------------------------ */

    function build(project, net) {
        var result = {
            ok: false,
            groups: [],
            rows: [],
            nodeLabels: {},
            segNames: {},
            head: null,
            checks: null,
            hydrants: [],
            air: null,
            warnings: []
        };

        if (!net.ok) return result;

        var groups = buildGroups(project, net);
        result.nodeLabels = numberGroups(project, groups);

        findAnalogs(net, groups);

        result.groups = groups;
        result.rows = buildRows(project, net, groups);
        result.rows.forEach(function (r) {
            if (r.type === 'seg') result.segNames[r.segId] = r.name;
        });

        result.head = systemHead(project, net);
        result.checks = checks(project, net);
        result.hydrants = hydrants(project, net);
        result.air = airCheck(project, net, result.warnings, result.hydrants);

        var planVpv = project.settings.planKind === 'vpv';

        result.hydrants.forEach(function (k) {
            if (!k.reach) {
                result.warnings.push(k.name + ' не соединён с вводом — его расход в расчёт не вошёл.');
                return;
            }
            // Кран без расчётных струй в проверку напора не идёт: в расчётном
            // случае он закрыт. Диаметр подводки от этого не зависит.
            if ((!planVpv || k.working) && k.valve < k.head - 1e-6) {
                result.warnings.push(k.name + ': давление у клапана ' + Fmt.num(k.valve, 2) + ' м меньше требуемого '
                    + Fmt.num(k.head, 2) + ' м.');
            }
            if (k.supplyDn !== null && k.supplyDn < 65) {
                result.warnings.push(k.name + ' присоединён к трубе Ду' + k.supplyDn
                    + ': по СП 485 п. 6.1.22 и 6.7.1.45 — не менее DN 65.');
            }
        });

        var c = result.checks;
        // Интенсивность и шаг — про оросители; на плане кранов их не проверяем.
        if (!planVpv && c.f > 0.85) {
            result.warnings.push('Коэффициент использования воды f = ' + Fmt.num(c.f, 2)
                + ' > 0,85: в «мёртвых зонах» нормативная интенсивность не обеспечена.');
        }
        if (!planVpv && project.settings.spacing > project.settings.maxSpacing) {
            result.warnings.push('Шаг оросителей ' + Fmt.trim(project.settings.spacing, 2)
                + ' м больше предельного ' + Fmt.trim(project.settings.maxSpacing, 2) + ' м.');
        }
        if (!planVpv && c.zoneArea > 0 && c.normArea > 0 && c.zoneArea < c.normArea * 0.98) {
            result.warnings.push('Расчётная зона ' + Fmt.num(c.zoneArea, 1) + ' м² меньше нормативной площади '
                + Fmt.trim(c.normArea, 1) + ' м².');
        }
        if (!planVpv && net.Qtotal > 0 && c.normFlow > 0 && net.Qtotal < c.normFlow * 0.999) {
            result.warnings.push('Расчётный расход ' + Fmt.num(net.Qtotal, 2) + ' л/с меньше нормативного '
                + Fmt.num(c.normFlow, 2) + ' л/с (I·S).');
        }

        result.ok = true;
        return result;
    }

    return {
        STYLES: STYLES,
        alphabet: function (i) { return alphabet(RU, i); },
        sequenceLabel: sequenceLabel,
        build: build
    };
})();
