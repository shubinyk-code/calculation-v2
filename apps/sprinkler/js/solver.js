'use strict';

/*
    Гидравлический расчёт сети по приложению Б СП 485.1311500.2020.

    Единицы: напор — м вод. ст., расход — л/с, длина — м, диаметр — мм.

        q  = K·√H              расход оросителя (Б.1.2.14.1; при H в метрах
                               тождественно 10·K·√P при P в МПа)
        ΔH = Q²·L / Kт         потери на участке (Б.1.2.14.3)
        Q  = √(B·H)            расход ветви с характеристикой B (Б.1.2.14.12)

    Как считает калькулятор Excel: марш от диктующего оросителя к вводу,
    напор растёт на потерях, расход — на каждом следующем оросителе; луч
    считается таким же маршем от напора диктующего, а в узел магистрали
    приводится множителем √(Hуз/Hк).

    Здесь то же самое, но без ручной сборки формул. Сеть однородна: все
    расходы оросителей пропорциональны √H, все потери — Q², поэтому
    характеристика B = Q²/H любого поддерева не зависит от рабочей точки
    и складывается по трём правилам:

        ороситель                         B = K²
        поддерево B за участком S = L/Kт  B' = 1/(1/B + S)
        узел, где сходятся B₁…Bₙ          B = (Σ√Bᵢ)²

    Отсюда три прохода без итераций: свёртка B снизу вверх, доли напора
    сверху вниз при H(ввод) = 1, масштаб по диктующему оросителю. На одном
    луче это в точности марш калькулятора, а приведение луча к узлу
    магистрали — частный случай свёртки. Проверено в tests.html на числах
    приложения 6 (паркинг).

    Однородность ломает только постоянный расход (пожарный кран): его
    вклад в √B равен q/√H и зависит от напора. Такой узел на каждой итерации
    подменяется однородным эквивалентом в текущей рабочей точке; сходится
    за несколько шагов, без кранов цикл выходит сразу.

    Полукольцо (СП Б.1.2.16.1): по каждому полукольцу идёт 50 % расхода.
    Участок с признаком ring пропускает половину расхода своего поддерева,
    потери на нём (Q/2)²·L/Kт — это то же, что сопротивление S·¼.
*/

var Solver = (function () {

    var MAX_VELOCITY = 10;

    function velocity(flow, dIn) {
        if (!(dIn > 0)) return 0;
        var d = dIn / 1000;
        return (4 * flow / 1000) / (Math.PI * d * d);
    }

    /*
        Внутреннее пожаротушение по плану: сеть рисуется целиком, со всеми
        кранами, а одновременно работает расчётное число струй (СП 10.13130
        табл. 7.1) — у самых невыгодных кранов. Невыгодность считаем напором,
        который кран требует на вводе, когда он один в работе: требуемое
        давление у клапана плюс потери по пути от ввода при расходе одной
        струи. Кран, которому струи не досталось, остаётся на плане
        геометрией: он нужен для объёма сети и для подписей.

        Выбор можно забрать у расчёта: у крана есть признак «в расчётном
        случае» — «да» ставит его в расчёт, «нет» убирает совсем, «авто»
        оставляет решение расчёту. Своё число струй у крана тоже назначает его
        в расчёт. Назначенные струи идут в счёт расчётных, остаток расходится
        по невыгодности между кранами на «авто».
    */
    function assignJets(project, net) {
        var quota = Math.round(project.settings.pkJets > 0 ? project.settings.pkJets : 0);
        var list = [];

        project.nodes.forEach(function (n) {
            var info = net.N[n.id];
            if (!n.pk || !info.reach || n.pk.use === false) return;

            var hyd = Model.hydrant(project, n, 1);
            var R = 0;
            var at = n.id;

            while (net.N[at].parent !== null) {
                R += net.S[net.N[at].pseg].R;
                at = net.N[at].parent;
            }

            list.push({
                id: n.id,
                own: n.pk.jets > 0 ? Math.round(n.pk.jets) : n.pk.use === true ? 1 : 0,
                rank: hyd.need + hyd.flow * hyd.flow * R
            });
        });

        list.sort(function (a, b) { return b.rank - a.rank || a.id - b.id; });

        list.forEach(function (x) {
            if (x.own > 0) {
                net.N[x.id].pkJets = x.own;
                quota -= x.own;
            }
        });

        var auto = list.filter(function (x) { return x.own === 0; });

        for (var i = 0; i < auto.length && quota > 0; i++) {
            net.N[auto[i].id].pkJets = 1;
            quota--;
        }

        // Струй больше, чем кранов: остаток берёт самый невыгодный кран.
        if (quota > 0 && auto.length) net.N[auto[0].id].pkJets += quota;
        else if (quota > 0 && list.length) net.N[list[0].id].pkJets += quota;

        // Назначили больше струй, чем положено по табл. 7.1 — это видно сразу.
        if (quota < 0) {
            net.warnings.push('Назначено ' + (Math.round(project.settings.pkJets) - quota) + ' стр. — больше расчётных '
                + Math.round(project.settings.pkJets) + ' стр.: расход системы считается по назначенным кранам.');
        }
    }

    /*
        Внутреннее пожаротушение по плану считается как ВПВ: потери по длине —
        по Дарси–Вейсбаху с λ по Шевелеву (неновые стальные трубы), а не через
        Kт. Итераций это не требует: расходы кранов заданы, а по дереву расход
        каждого участка — сумма расходов ниже него. Поэтому расходы собираются
        снизу вверх, потери считаются по ним, и остаётся найти напор на вводе:
        он такой, чтобы самому невыгодному крану хватило его давления.
    */
    function shevelevPass(project, net, hydrants) {
        var hydr = project.settings.hydr || { formula: 'shevelev', nu: 1.31, reserve: 1 };
        var byId = {};
        project.segments.forEach(function (seg) { byId[seg.id] = seg; });

        // Расходы: снизу вверх по дереву.
        net.order.slice().reverse().forEach(function (id) {
            var info = net.N[id];
            var sum = info.fixed > 0 ? info.fixed : 0;
            info.children.forEach(function (c) { sum += net.N[c].Qsub; });
            info.Qsub = sum;
            info.qOwn = info.fixed > 0 ? info.fixed : 0;
            info.H = 0;

            if (info.pseg === null) return;
            var seg = net.S[info.pseg];
            seg.Qsub = sum;
            seg.Q = seg.m * sum;
        });

        // Потери по каждому участку дерева.
        net.order.forEach(function (id) {
            var info = net.N[id];
            if (info.pseg === null) return;

            var seg = net.S[info.pseg];
            var pipe = Vpv.pipeOf(byId[seg.id], hydr.reserve);
            var r = Vpv.darcy(seg.Q, seg.L, pipe, hydr);

            seg.dCalc = pipe.dCalc;
            seg.lambda = r.lambda;
            seg.Re = r.Re;
            seg.V = r.V;
            seg.dH = r.dH;
        });

        // Потери от ввода до каждого узла и напор на вводе по худшему крану.
        var loss = {};
        net.order.forEach(function (id) {
            var info = net.N[id];
            loss[id] = info.parent === null ? 0 : loss[info.parent] + net.S[info.pseg].dH;
        });

        var dict = null;
        var top = 0;

        hydrants.forEach(function (id) {
            var need = net.N[id].pkNeed + loss[id];
            if (dict === null || need > top + 1e-12) {
                top = need;
                dict = id;
            }
        });

        if (dict === null) return;

        net.order.forEach(function (id) { net.N[id].H = top - loss[id]; });

        net.dict = dict;
        net.dictKind = 'pk';
        net.alpha = 1;

        var path = [];
        for (var at = dict; at !== null; at = net.N[at].parent) path.push(at);
        net.path = path;

        net.Hsource = net.N[net.source].H;
        net.Hdict = net.N[dict].H;
        net.HnetRaw = net.Hsource - net.Hdict;
        net.Qtotal = net.N[net.source].Qsub;
        net.shevelev = Vpv.FORMULAS[hydr.formula] || Vpv.FORMULAS.shevelev;
    }

    function solve(project) {
        var s = project.settings;
        var net = {
            ok: false,
            errors: [],
            warnings: [],
            source: null,
            N: {},
            S: {},
            order: [],
            dict: null,
            path: [],
            alpha: 0,
            Qtotal: 0,
            Hsource: 0,
            Hdict: 0,
            HnetRaw: 0,
            cycles: []
        };

        var i;
        var adjacency = {};

        project.nodes.forEach(function (n) {
            adjacency[n.id] = [];
            net.N[n.id] = {
                id: n.id,
                parent: null,
                pseg: null,
                children: [],
                depth: -1,
                reach: false,
                working: false,
                fixed: 0,
                pkJets: 0,
                k: n.k > 0 ? n.k : s.k,
                B: 0,
                h: 0,
                H: 0,
                Qsub: 0,
                qOwn: 0,
                active: false
            };
        });

        project.segments.forEach(function (seg) {
            if (!adjacency[seg.a] || !adjacency[seg.b]) return;

            adjacency[seg.a].push(seg);
            adjacency[seg.b].push(seg);

            var pipe = Catalog.pipe(seg);
            var L = Model.length(project, seg);
            var m = seg.ring ? 0.5 : 1;

            net.S[seg.id] = {
                id: seg.id,
                inTree: false,
                L: L,
                kt: pipe.kt,
                dIn: pipe.dIn,
                dn: pipe.dn,
                ktSource: pipe.source,
                m: m,
                R: pipe.kt > 0 ? m * m * L / pipe.kt : 0,
                up: null,
                down: null,
                Qsub: 0,
                Q: 0,
                V: 0,
                dH: 0,
                active: false
            };
        });

        var src = Model.source(project);
        if (!src) {
            net.errors.push('Поставьте ввод: от него ведётся расчёт.');
            return net;
        }
        net.source = src.id;

        /* --- дерево от ввода ------------------------------------------------ */

        var queue = [src.id];
        net.N[src.id].reach = true;
        net.N[src.id].depth = 0;

        while (queue.length) {
            var id = queue.shift();
            net.order.push(id);

            adjacency[id].forEach(function (seg) {
                var next = seg.a === id ? seg.b : seg.a;
                var info = net.N[next];

                if (info.reach) {
                    // Второй путь к уже достигнутому узлу — контур.
                    if (!net.S[seg.id].inTree && net.cycles.indexOf(seg.id) < 0 && net.N[id].pseg !== seg.id) {
                        net.cycles.push(seg.id);
                    }
                    return;
                }

                info.reach = true;
                info.parent = id;
                info.pseg = seg.id;
                info.depth = net.N[id].depth + 1;
                net.N[id].children.push(next);

                net.S[seg.id].inTree = true;
                net.S[seg.id].up = id;
                net.S[seg.id].down = next;

                queue.push(next);
            });
        }

        if (net.cycles.length) {
            net.warnings.push('В сети есть замкнутый контур (' + net.cycles.length
                + ' участк.): замыкающие участки в расчёт не вошли. Для кольцевой '
                + 'магистрали по СП Б.1.2.16.1 отметьте участки признаком «полукольцо, 50 %».');
        }

        /* --- кто даёт воду ---------------------------------------------------- */

        var working = [];
        var fixed = [];
        var hydrants = [];
        var lost = 0;
        var byPlan = s.planKind === 'vpv';

        // На плане внутреннего пожаротушения сначала решаем, какие краны работают.
        if (byPlan) assignJets(project, net);

        project.nodes.forEach(function (n) {
            var info = net.N[n.id];
            var inZone = Model.inZone(project, n);

            // На плане внутреннего пожаротушения расчётные точки — краны;
            // ороситель, если его нарисовали по ошибке, в работу не идёт.
            if (n.spr && !n.off && inZone && !byPlan) {
                if (info.reach) {
                    info.working = true;
                    working.push(n.id);
                } else {
                    lost++;
                }
            }

            // Пожарный кран — постоянный расход n·q и требуемое давление у
            // клапана. По СП 485 Б.1.3.16 он входит в расчётную сеть, а не
            // прибавляется к расходу АУП.
            var hyd = Model.hydrant(project, n, byPlan ? info.pkJets : undefined);
            var flow = (n.q > 0 ? n.q : 0) + (hyd && info.reach ? hyd.Q : 0);

            if (flow > 0 && info.reach) {
                info.fixed = flow;
                fixed.push(n.id);
            }

            // Напор требует только работающий кран: нерабочие на плане —
            // геометрия, иначе диктующим стал бы кран без расхода.
            if (hyd && info.reach && hyd.need > 0 && (!byPlan || info.pkJets > 0)) {
                info.pkNeed = hyd.need;
                hydrants.push(n.id);
            }
        });

        if (lost) {
            net.warnings.push(lost + ' работающ. оросител. не соединены с вводом и в расчёт не вошли.');
        }

        if (!working.length && !hydrants.length) {
            var what = byPlan ? 'пожарных кранов' : 'оросителей';
            var anyPk = byPlan && project.nodes.some(function (n) { return n.pk && net.N[n.id].reach; });

            if (byPlan && !(s.pkJets > 0)) {
                net.errors.push('Задайте число струй в исходных данных: по нему выбираются расчётные краны.');
            } else if (anyPk) {
                net.errors.push('Ни один пожарный кран не принят в расчётный случай: '
                    + 'поставьте хотя бы одному признак «в расчёте» или верните «авто».');
            } else {
                net.errors.push(Model.hasZone(project)
                    ? 'В расчётной зоне нет ' + what + ', соединённых с вводом.'
                    : 'Нет ' + what + ', соединённых с вводом.');
            }
            return net;
        }

        var reverse = net.order.slice().reverse();

        reverse.forEach(function (id) {
            var info = net.N[id];
            info.active = info.working || info.fixed > 0;
            info.children.forEach(function (c) {
                if (net.N[c].active) info.active = true;
            });
        });

        /* --- свёртка и масштаб ------------------------------------------------ */

        var guess = {};
        fixed.forEach(function (id) { guess[id] = s.dictHead; });

        var forced = null;
        project.nodes.forEach(function (n) {
            if (n.dict && net.N[n.id].working) forced = n.id;
        });

        var alpha = 0;
        var dict = null;

        for (var iter = 0; iter < 100; iter++) {
            reverse.forEach(function (id) {
                var info = net.N[id];
                var root = 0;

                if (info.working) root += info.k;
                if (info.fixed > 0) root += info.fixed / Math.sqrt(Math.max(guess[id], 1e-6));

                info.children.forEach(function (c) {
                    var child = net.N[c];
                    if (child.B <= 0) return;

                    var R = net.S[child.pseg].R;
                    var through = R > 0 ? 1 / (1 / child.B + R) : child.B;
                    root += Math.sqrt(through);
                });

                info.B = root * root;
            });

            net.order.forEach(function (id) {
                var info = net.N[id];
                if (info.parent === null) {
                    info.h = 1;
                    return;
                }
                info.h = net.N[info.parent].h / (1 + info.B * net.S[info.pseg].R);
            });

            alpha = 0;
            dict = null;

            if (forced !== null) {
                dict = forced;
                alpha = s.dictHead / net.N[forced].h;
            } else {
                // При равенстве — узел, начерченный раньше: у отражённого
                // аналога диктующего луча напор ровно тот же.
                working.forEach(function (id) {
                    var need = s.dictHead / net.N[id].h;
                    if (dict === null || need > alpha * (1 + 1e-12)
                        || (Math.abs(need - alpha) <= alpha * 1e-12 && id < dict)) {
                        alpha = need;
                        dict = id;
                    }
                });

                // Кран, которому давления не хватает, сам становится
                // диктующей точкой — оросители тогда получают с запасом.
                hydrants.forEach(function (id) {
                    var need = net.N[id].pkNeed / net.N[id].h;
                    if (dict === null || need > alpha * (1 + 1e-12)) {
                        alpha = need;
                        dict = id;
                    }
                });
            }

            if (!fixed.length) break;

            var change = 0;
            fixed.forEach(function (id) {
                var H = alpha * net.N[id].h;
                change = Math.max(change, Math.abs(H - guess[id]) / Math.max(H, 1e-9));
                guess[id] = H;
            });

            if (change < 1e-13) break;
        }

        net.alpha = alpha;
        net.dict = dict;
        net.dictKind = net.N[dict].working ? 'sprinkler' : 'pk';

        /* --- разноска по узлам и участкам ------------------------------------- */

        net.order.forEach(function (id) {
            var info = net.N[id];
            info.H = alpha * info.h;
            info.Qsub = Math.sqrt(info.B * info.H);

            if (info.working) info.qOwn = info.k * Math.sqrt(info.H);
            else if (info.fixed > 0) info.qOwn = info.fixed;

            if (info.pseg === null) return;

            var seg = net.S[info.pseg];
            seg.Qsub = info.Qsub;
            seg.Q = seg.m * info.Qsub;
            seg.dH = info.Qsub * info.Qsub * seg.R;
            seg.V = velocity(seg.Q, seg.dIn);
            seg.active = info.active;
        });

        var path = [];
        for (var at = dict; at !== null; at = net.N[at].parent) path.push(at);
        net.path = path;

        net.Hsource = net.N[src.id].H;
        net.Hdict = net.N[dict].H;
        net.HnetRaw = net.Hsource - net.Hdict;
        net.Qtotal = net.N[src.id].Qsub;

        // План внутреннего пожаротушения: напоры и потери — по Шевелеву.
        if (byPlan) shevelevPass(project, net, hydrants);

        /* --- замечания -------------------------------------------------------- */

        var fast = [];
        var formula = 0;
        var none = 0;

        project.segments.forEach(function (seg) {
            var info = net.S[seg.id];
            if (!info || !info.active) return;

            if (info.V > MAX_VELOCITY) fast.push(info);
            // На плане кранов Kт не участвует: потери считаются по Шевелеву.
            if (byPlan) return;
            if (info.ktSource === 'formula') formula++;
            if (info.ktSource === 'none') none++;
        });

        if (fast.length) {
            net.warnings.push('Скорость выше ' + MAX_VELOCITY + ' м/с на ' + fast.length
                + ' участк. — увеличьте диаметр.');
        }
        if (formula) {
            net.warnings.push('Kт на ' + formula + ' участк. взято по эмпирической формуле: '
                + 'размера нет в таблице.');
        }
        if (none) {
            net.warnings.push('Kт на ' + none + ' участк. не определено — потери на них нулевые.');
        }

        if (forced !== null) {
            var low = working.filter(function (id) {
                return net.N[id].H < s.dictHead - 1e-6;
            }).length;
            if (low) {
                net.warnings.push('Диктующий ороситель назначен вручную, но у ' + low
                    + ' оросител. напор ниже ' + s.dictHead + ' м.');
            }
        }

        net.ok = true;
        return net;
    }

    return {
        MAX_VELOCITY: MAX_VELOCITY,
        velocity: velocity,
        solve: solve
    };
})();
