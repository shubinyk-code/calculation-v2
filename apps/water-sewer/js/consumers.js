/*
    Потребители и своды по ним.

    ГЛАВНОЕ РЕШЕНИЕ. Потребитель лежит в списке ОДИН раз, а «Итого по…» — это
    не место хранения, а ВЫБОРКА: набор ссылок на потребителей. Поэтому один и
    тот же потребитель входит в любое число итогов сразу — и в «Итого по жилым
    помещениям», и в «1 зона», и в «ИТОГО ПО ОБЪЕКТУ», — не размножаясь.

    Была бы вместо этого древовидная раскладка «папка → потребители», пришлось
    бы либо заводить копию жилой части в каждой ветке (и следить, чтобы копии
    не разошлись), либо считать зоны отдельным расчётом. Обе беды известны по
    ручным таблицам: там жильё переписывают в три места, а потом правят в двух.

    НАБОРЫ ВЛОЖЕННЫЕ. Набор может включать другие наборы: «ИТОГО ПО ОБЪЕКТУ» —
    это «Итого по жилым» плюс «Итого по встроенным», и перечислять потребителей
    заново не нужно. Состав разворачивается рекурсивно, дубликаты отбрасываются:
    потребитель, попавший в свод двумя путями, посчитается один раз.

    СВОД — НЕ СУММА. Секундные и часовые расходы набора считаются по формулам
    (1) и (4) СП 30, то есть через общую вероятность действия приборов. Прямая
    сумма даёт заведомо завышенный расход. Суточные объёмы, наоборот, именно
    складываются — вероятность к ним отношения не имеет.

    Проверено на выпущенном томе: у двух жилых секций 4,656 и 1,610 л/с, а их
    свод — 5,222 л/с, а не 6,266.

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

    /* --- наборы ---------------------------------------------------------- */

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

    function byId(list, id) {
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }

    /*
        Свод по набору: формулы (1) и (4).

        Суточные объёмы складываются напрямую — их считает Demand.combine по
        сумме q_u · U, но с ЧАСОВЫМ количеством потребителей. Поэтому после
        свода суточная часть пересчитывается по суточным количествам.
    */
    function runSet(set, project, node) {
        var consumers = expand(set, project);
        var groups = [];
        var i;

        for (i = 0; i < consumers.length; i++) {
            var g = group(consumers[i]);
            if (g) groups.push(g);
        }

        if (groups.length === 0) return null;

        var result = groups.length === 1
            ? Demand.run(groups[0], node)
            : Demand.combine(set.name, groups, node);

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
        result.set = set;

        return result;
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
        expand: expand,
        byId: byId,
        runSet: runSet,
        extraDay: extraDay,
        balance: balance
    };
})();
