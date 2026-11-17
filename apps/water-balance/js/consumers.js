/*
    Потребители, дерево папок и произвольные своды по ним.

    ГЛАВНОЕ РЕШЕНИЕ. Потребитель лежит в списке ОДИН раз, как и раньше. Новое —
    в том, ЧТО служит местом хранения группировки: раньше группа была записью в
    плоском списке и отвечала только за раскладку формы баланса, а любая гибкая
    выборка («Итого по жилым», «1 зона», «ИТОГО ПО ОБЪЕКТУ») собиралась отдельно,
    галочками в матрице «потребитель × итог».

    Теперь группа — узел ДЕРЕВА (папка), и папка НЕСЁТ авто-итог: сумма (по
    формулам (1) и (4) СП 30, не сложением) всех потребителей, лежащих в ней
    самой и во вложенных папках. Родительская папка ничего не переписывает
    заново — просто разворачивает поддерево. Это не место хранения "второй
    копии" потребителя: разворачивание идёт от списка потребителей и их поля
    group, а сама папка не хранит ссылок на них.

    «ИТОГИ» (project.sets) остаются рядом — как раньше, только на случай зон,
    которые не укладываются в дерево (пересекают две разные папки). Матрица
    «потребитель × итог» с галочками, вложенность, отсутствие циклов — без
    изменений.

    СВОД — НЕ СУММА. Секундные и часовые расходы набора считаются по формулам
    (1) и (4) СП 30, то есть через общую вероятность действия приборов. Прямая
    сумма даёт заведомо завышенный расход. Суточные объёмы, наоборот, именно
    складываются — вероятность к ним отношения не имеет.

    ДВА КОЛИЧЕСТВА ПОТРЕБИТЕЛЕЙ. Суточное и часовое — разные числа, и это не
    прихоть: суточный объём считают по фактической заселённости, а вероятность
    действия приборов — по расчётной. В формах это пишут через дробь: «291/620».
*/

var Consumers = (function () {
    'use strict';

    /* --- справочники значений ------------------------------------------- */

    /* Источники водоснабжения — колонки 10–13 формы баланса. */
    var SOURCES = [
        { id: 'city', name: 'Городской водопровод' },
        { id: 'well', name: 'Артезианские скважины' },
        { id: 'tech', name: 'Технический водопровод' },
        { id: 'recycle', name: 'Оборотно-повторные системы' }
    ];

    /* Куда уходит сток — колонки 15–19 формы баланса. */
    var DRAINS = [
        { id: 'household', name: 'Хозяйственно-бытовые' },
        { id: 'clean', name: 'Нормативно чистые' },
        { id: 'mineral', name: 'Загрязнённые механич. минерал. примесями' },
        { id: 'chemical', name: 'Загрязнённые химич. органич. и проч. примесями' },
        { id: 'storm', name: 'Водосток' }
    ];

    function sourceName(id) {
        for (var i = 0; i < SOURCES.length; i++) if (SOURCES[i].id === id) return SOURCES[i].name;
        return SOURCES[0].name;
    }

    function drainName(id) {
        for (var i = 0; i < DRAINS.length; i++) if (DRAINS[i].id === id) return DRAINS[i].name;
        return DRAINS[0].name;
    }

    /* --- потребитель ----------------------------------------------------- */

    /*
        Группа расчёта из потребителя.

        usersHour идёт в вероятность действия приборов, usersDay — в суточный
        объём. Когда часовое количество не задано, берётся суточное: у
        большинства потребителей они совпадают, и заставлять вводить одно и то
        же дважды незачем.
    */
    function group(consumer) {
        var norm = Tables.norm(consumer.norm);
        if (!norm) return null;

        var usersHour = consumer.usersHour > 0 ? consumer.usersHour : consumer.usersDay;

        /*
            Норма с изменённым временем работы: у встроенных помещений смена
            может отличаться от табличной, а T входит в средний часовой расход.
        */
        var used = norm;

        if (consumer.hours > 0 && consumer.hours !== norm.t) {
            used = {};
            for (var key in norm) if (norm.hasOwnProperty(key)) used[key] = norm[key];
            used.t = consumer.hours;
        }

        return {
            name: consumer.name || norm.name,
            norm: used,
            users: usersHour,
            usersDay: consumer.usersDay,
            fixtures: consumer.fixtures > 0 ? consumer.fixtures : usersHour,
            fixturesHot: consumer.fixturesHot > 0 ? consumer.fixturesHot : usersHour,
            q0Sewer: consumer.q0Sewer > 0 ? consumer.q0Sewer : 1.6,
            consumer: consumer
        };
    }

    /*
        Расчёт одного потребителя.

        Суточный объём считается по СВОЕМУ количеству — тому, что для суток, —
        а не по часовому, поэтому пересчитывается после общего расчёта. Иначе
        291 житель по суткам и 620 по часу дали бы 111,6 м³/сут вместо 52,38.
    */
    function run(consumer, node) {
        var g = group(consumer);
        if (!g) return null;

        var result = Demand.run(g, node);

        applyDayUsers(result, g);

        return result;
    }

    function applyDayUsers(result, g) {
        var norm = g.norm;
        var day = g.usersDay > 0 ? g.usersDay : g.users;

        var branches = [
            [result.total, norm.qu],
            [result.hot, norm.quh],
            [result.cold, norm.quc]
        ];

        for (var i = 0; i < branches.length; i++) {
            var flow = branches[i][0];
            if (!flow) continue;

            flow.usersDay = day;
            flow.qDay = branches[i][1] * day / 1000;
            flow.qAvgHour = norm.t > 0 ? flow.qDay / norm.t : 0;
            flow.khr = flow.qAvgHour > 0 ? flow.qhr / flow.qAvgHour : 0;
        }

        result.sewerDay = result.total ? result.total.qDay : 0;
    }

    function byId(list, id) {
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }

    /* --- дерево папок ------------------------------------------------------
        Папка (project.groups) — узел дерева: {id, name, parentId}. Корень —
        parentId === ''. Циклы недопустимы: нормализация проекта (storage.js)
        их разрывает при чтении файла, а UI не даёт создать новый.
    */

    function roots(project) {
        var out = [];
        for (var i = 0; i < project.groups.length; i++) {
            if (!project.groups[i].parentId) out.push(project.groups[i]);
        }
        return out;
    }

    function children(groupId, project) {
        var out = [];
        for (var i = 0; i < project.groups.length; i++) {
            if (project.groups[i].parentId === groupId) out.push(project.groups[i]);
        }
        return out;
    }

    /*
        Узел b лежит внутри поддерева узла a (включая сам a).

        Нужен, чтобы запретить перенос папки в её же потомка: иначе дерево
        разорвалось бы на кольцо, недостижимое от корня.
    */
    function isInside(aId, bId, project) {
        var node = byId(project.groups, bId);
        var seen = {};

        while (node) {
            if (node.id === aId) return true;
            if (seen[node.id]) return false;
            seen[node.id] = true;
            node = node.parentId ? byId(project.groups, node.parentId) : null;
        }

        return false;
    }

    /* Все id узлов поддерева groupId, включая сам groupId. */
    function subtreeGroupIds(groupId, project) {
        var out = [groupId];
        var stack = [groupId];

        while (stack.length) {
            var current = stack.pop();
            var kids = children(current, project);

            for (var i = 0; i < kids.length; i++) {
                out.push(kids[i].id);
                stack.push(kids[i].id);
            }
        }

        return out;
    }

    /* Потребители, лежащие прямо в папке (без вложенных). */
    function consumersIn(groupId, project) {
        var out = [];
        for (var i = 0; i < project.consumers.length; i++) {
            if (project.consumers[i].group === groupId) out.push(project.consumers[i]);
        }
        return out;
    }

    /* Прочие расходы, лежащие прямо в папке. */
    function extrasIn(groupId, project) {
        var out = [];
        for (var i = 0; i < project.extras.length; i++) {
            if (project.extras[i].group === groupId) out.push(project.extras[i]);
        }
        return out;
    }

    /* Все потребители папки И её вложенных папок — то, что суммирует авто-итог. */
    function consumersInSubtree(groupId, project) {
        var ids = subtreeGroupIds(groupId, project);
        var set = {};
        for (var i = 0; i < ids.length; i++) set[ids[i]] = true;

        var out = [];
        for (i = 0; i < project.consumers.length; i++) {
            if (set[project.consumers[i].group]) out.push(project.consumers[i]);
        }
        return out;
    }

    /* Хлебные крошки «Корпус А → Секция 1» — для заголовков и подписей. */
    function path(groupId, project, sep) {
        var names = [];
        var node = byId(project.groups, groupId);
        var seen = {};

        while (node) {
            names.unshift(node.name);
            if (seen[node.id]) break;
            seen[node.id] = true;
            node = node.parentId ? byId(project.groups, node.parentId) : null;
        }

        return names.join(sep || ' → ');
    }

    /* --- наборы (вкладка «Итоги») ------------------------------------------
        Отдельный, необязательный слой поверх дерева: произвольная выборка
        потребителей за пределами структуры папок.
    */

    /*
        Развернуть состав набора в список потребителей.

        Рекурсия по вложенным наборам с защитой от кольца: набор, включающий
        сам себя через цепочку, иначе повесил бы страницу намертво. Кольцо
        здесь не ошибка ввода, а естественная опечатка — «объект» включает
        «зону», а «зона» по недосмотру «объект».
    */
    function expand(set, project, seen) {
        seen = seen || {};
        if (seen[set.id]) return [];
        seen[set.id] = true;

        var found = [];
        var i;

        for (i = 0; i < set.members.length; i++) {
            var consumer = byId(project.consumers, set.members[i]);
            if (consumer) found.push(consumer);
        }

        for (i = 0; i < set.sets.length; i++) {
            var inner = byId(project.sets, set.sets[i]);
            if (!inner) continue;

            var deeper = expand(inner, project, seen);
            for (var k = 0; k < deeper.length; k++) found.push(deeper[k]);
        }

        // Потребитель, попавший двумя путями, считается один раз.
        var unique = [];
        var used = {};

        for (i = 0; i < found.length; i++) {
            if (used[found[i].id]) continue;
            used[found[i].id] = true;
            unique.push(found[i]);
        }

        return unique;
    }

    /*
        Свод по произвольному списку потребителей: формулы (1) и (4).

        Общее ядро для авто-итога папки (runGroup) и ручного «Итога» (runSet) —
        обоим нужно одно и то же: взять список потребителей, свести секундные и
        часовые расходы через общую вероятность действия приборов, а суточные
        объёмы сложить напрямую по КАЖДОМУ своим количеством.
    */
    function combine(name, consumers, node) {
        var groups = [];

        for (var i = 0; i < consumers.length; i++) {
            var g = group(consumers[i]);
            if (g) groups.push(g);
        }

        if (groups.length === 0) return null;

        var result = groups.length === 1
            ? Demand.run(groups[0], node)
            : Demand.combine(name, groups, node);

        // Суточные объёмы — сумма по потребителям, каждый со своим количеством.
        var day = { total: 0, hot: 0, cold: 0 };
        var usersDay = 0;
        var usersHour = 0;
        var t = 0;

        for (i = 0; i < groups.length; i++) {
            var one = groups[i];
            var count = one.usersDay > 0 ? one.usersDay : one.users;

            day.total += one.norm.qu * count / 1000;
            day.hot += one.norm.quh * count / 1000;
            day.cold += one.norm.quc * count / 1000;

            usersDay += count;
            usersHour += one.users;

            if (one.norm.t > t) t = one.norm.t;
        }

        var branches = [[result.total, day.total], [result.hot, day.hot], [result.cold, day.cold]];

        for (i = 0; i < branches.length; i++) {
            var flow = branches[i][0];
            if (!flow) continue;

            flow.qDay = branches[i][1];
            flow.qAvgHour = t > 0 ? flow.qDay / t : 0;
            flow.khr = flow.qAvgHour > 0 ? flow.qhr / flow.qAvgHour : 0;
        }

        result.sewerDay = result.total ? result.total.qDay : 0;
        result.group.usersDay = usersDay;
        result.group.users = usersHour;
        result.consumers = consumers;

        return result;
    }

    function runSet(set, project, node) {
        var consumers = expand(set, project);
        var result = combine(set.name, consumers, node);
        if (result) result.set = set;
        return result;
    }

    /*
        Авто-итог папки: свод по НЕЙ САМОЙ и всем вложенным папкам сразу.

        Точен независимо от глубины вложенности — взвешенные суммы формул (1) и
        (4) складываются по всем потребителям поддерева, а не по заранее
        свёрнутым итогам дочерних папок, поэтому результат не зависит от того,
        как именно разложено дерево.
    */
    function runGroup(groupId, project, node) {
        var consumers = consumersInSubtree(groupId, project);
        var g = byId(project.groups, groupId);
        return combine(g ? g.name : '', consumers, node);
    }

    /*
        Строки таблицы «Основные показатели по системе водоснабжения и
        водоотведения» — общий источник для экрана (ui-totals.js) и выгрузки
        (report.js), чтобы они не расходились: один потребитель — четыре
        строки (В1 / Т3 / В1 общ. / К1), папки — заголовком и, если в поддереве
        больше одного потребителя, авто-итогом после дочерних, дальше прочие
        расходы, автоматический «ИТОГО ПО ОБЪЕКТУ» и ручные «Итоги».

        Авто-итог папки с одним-единственным потребителем не печатается — он
        дословно повторил бы уже показанную строку этого потребителя.
    */
    function mainRows(project, node) {
        var rows = [];
        var bold = [];

        function pairLabel(g) {
            return g.usersDay === g.users ? String(g.usersDay) : g.usersDay + '/' + g.users;
        }

        function countsLabel(consumer) {
            var hour = consumer.usersHour > 0 ? consumer.usersHour : consumer.usersDay;
            return consumer.usersDay === hour
                ? String(consumer.usersDay)
                : consumer.usersDay + '/' + hour;
        }

        function block(name, usersLabel, result, note) {
            bold.push(rows.length);
            rows.push([name, usersLabel, '', '', '', '', note || '']);

            if (!result) {
                rows.push(['Расход не считается: не заданы норма или количество',
                    '', '', '', '', '', '']);
                return;
            }

            var norm = result.group && result.group.norm ? result.group.norm : null;

            var systems = [
                ['В1', result.cold, norm ? norm.quc : 0],
                ['Т3', result.hot, norm ? norm.quh : 0],
                ['В1 общ.', result.total, norm ? norm.qu : 0]
            ];

            for (var i = 0; i < systems.length; i++) {
                var flow = systems[i][1];
                if (!flow) continue;

                rows.push(['    ' + systems[i][0], '',
                    systems[i][2] > 0 ? systems[i][2] : '',
                    flow.qDay, flow.qhr, flow.q, '']);
            }

            rows.push(['    К1', '', norm && norm.qu > 0 ? norm.qu : '',
                result.sewerDay, result.total ? result.total.qhr : 0, result.sewer,
                'формула (5)']);
        }

        function walk(groupId) {
            var direct = consumersIn(groupId, project);
            var kids = children(groupId, project);
            var label = path(groupId, project);
            var any = false;
            var i;

            if (direct.length) {
                bold.push(rows.length);
                rows.push([label, '', '', '', '', '', '']);

                for (i = 0; i < direct.length; i++) {
                    var c = direct[i];
                    block(c.name, countsLabel(c), run(c, node), c.note);
                }

                any = true;
            }

            for (i = 0; i < kids.length; i++) {
                if (walk(kids[i].id)) any = true;
            }

            var subCount = consumersInSubtree(groupId, project).length;

            if (kids.length > 0 && subCount >= 2) {
                var result = runGroup(groupId, project, node);
                block('Итого по «' + label + '»:', pairLabel(result.group), result,
                    'потребителей: ' + subCount);
                any = true;
            }

            return any;
        }

        var top = roots(project);
        for (var r = 0; r < top.length; r++) walk(top[r].id);

        if (project.extras.length) {
            bold.push(rows.length);
            rows.push(['Прочие расходы', '', '', '', '', '', '']);

            for (var e = 0; e < project.extras.length; e++) {
                var extra = project.extras[e];

                rows.push([extra.name, extra.count > 0 ? extra.count + ' ' + extra.unit : '',
                    extra.rate > 0 ? extra.rate : '', extraDay(extra), '',
                    extra.ls > 0 ? extra.ls : '', extra.note]);
            }
        }

        var totalFrom = rows.length;

        if (project.consumers.length >= 2) {
            var grand = combine('ИТОГО ПО ОБЪЕКТУ', project.consumers, node);
            if (grand) {
                block('ИТОГО ПО ОБЪЕКТУ:', pairLabel(grand.group), grand,
                    'потребителей: ' + project.consumers.length);
            }
        }

        for (var s = 0; s < project.sets.length; s++) {
            var setResult = runSet(project.sets[s], project, node);
            if (!setResult) continue;

            block(project.sets[s].name + ':', pairLabel(setResult.group), setResult,
                'потребителей: ' + setResult.consumers.length);
        }

        return {
            rows: rows,
            bold: bold,
            total: rows.length > totalFrom ? totalFrom : undefined
        };
    }

    /* --- прочие расходы --------------------------------------------------- */

    /*
        Полив, пожаротушение, технологические нужды — расходы, которые НЕ
        считаются по вероятности действия приборов и задаются прямо.

        В своды по формулам (1) и (4) они не входят: складывать вероятностный
        расход с заданным напрямую нельзя, вероятность к последнему отношения
        не имеет. В суточный баланс они попадают слагаемым, а в таблицу
        расходов — отдельной строкой, как это и делается в записке: «Полив
        территории», «Пожаротушение жилого дома — внутреннее 2×2,9 л/с».
    */
    function extraDay(extra) {
        if (extra.m3day > 0) return extra.m3day;

        // Норма в л на единицу в сутки: зелёные насаждения 3 л/м², твёрдые 0,4.
        return extra.count * extra.rate / 1000;
    }

    /* --- балансовые величины ---------------------------------------------- */

    /*
        Строка баланса водопотребления: сколько взято, откуда, сколько потеряно
        безвозвратно и сколько ушло в канализацию.

        Безвозвратные потери задаются процентом: в форме они стоят объёмом, но
        вводить объём руками значит держать в голове, что он не должен
        превышать водопотребление. Процент такой ошибки не допускает.
    */
    function balance(consumer, m3day) {
        var loss = m3day * Math.min(100, Math.max(0, consumer.lossPercent || 0)) / 100;

        return {
            total: m3day,
            source: consumer.source || 'city',
            loss: loss,
            drain: consumer.drain || 'household',
            drained: Math.max(0, m3day - loss)
        };
    }

    return {
        SOURCES: SOURCES,
        DRAINS: DRAINS,
        sourceName: sourceName,
        drainName: drainName,
        group: group,
        run: run,
        byId: byId,
        roots: roots,
        children: children,
        isInside: isInside,
        subtreeGroupIds: subtreeGroupIds,
        consumersIn: consumersIn,
        extrasIn: extrasIn,
        consumersInSubtree: consumersInSubtree,
        path: path,
        expand: expand,
        combine: combine,
        runSet: runSet,
        runGroup: runGroup,
        mainRows: mainRows,
        extraDay: extraDay,
        balance: balance
    };
})();
