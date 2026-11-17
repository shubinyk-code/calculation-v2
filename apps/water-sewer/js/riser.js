/*
    Канализационный стояк: расход стоков по этажам и проверка на срыв
    гидрозатворов.

    ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ. Когда по стояку идёт сток, воздух увлекается вниз
    вместе с водой, и над местом сброса возникает разрежение. Если оно окажется
    больше высоты запирающего слоя в сифоне, воду из гидрозатвора вытянет в
    стояк — затвор сорвёт, и канализационный воздух пойдёт в помещение.

    Прямо разрежение СП 30 считать не заставляет: приложение К даёт готовую
    пропускную способность стояков, полученную испытаниями из условия, что
    разрежение не срывает гидрозатворы. Поэтому проверка на срыв гидрозатвора —
    это сравнение расчётного расхода стоков с табличной пропускной способностью
    по 8.3.3:

        q_s ≤ q_К

    и она зависит не только от диаметра стояка, а от четырёх вещей сразу:
    материала, диаметра стояка, диаметра поэтажного отвода и УГЛА присоединения
    отвода. У стояка Ø110 из ПВХ при отводах под 45° это 8,22 л/с, а под 87,5° —
    4,83 л/с. Разница почти вдвое, и берётся она из тройника, а не из диаметра.

    УЧАСТКИ. Стояк редко бывает однородным: на типовых этажах пять приборов, на
    верхних — шесть, внизу встроенные помещения со своим набором. Поэтому этажи
    задаются УЧАСТКАМИ: «с 1 по 16 — такой набор, с 17 по 25 — такой». Участок
    несёт свой набор приборов и своё число жильцов на этаж.

    Раскладка по одному набору на весь стояк — частный случай: один участок от
    первого этажа до последнего.

    ПОРЯДОК РАСЧЁТА. Этажи нумеруются как в проекте: первый — нижний. Стояк
    собирает стоки сверху вниз, поэтому на этаже f он несёт приборы этажей от f
    и выше, а расчётное сечение — основание, то есть первый этаж.

    Цепочка на каждом этаже (номера формул по СП 30.13330.2020):

        N     — приборов на этом этаже и выше
        U     — жильцов на этом этаже и выше
        P     = q_hr,u · U / (3600 · q0 · N)          (3)
        α     — по таблице Б.1 или Б.2                (5.3)
        q_tot = 5 · q0 · α                            (2)
        q_s   = q_tot + q0_s                          (5), при q_tot ≤ 8 л/с
*/

var Riser = (function () {
    'use strict';

    /*
        Набор приборов этажа: список {name, count}.

        Отсюда берутся два числа: сколько приборов на этаже (N этажа) и расход
        стоков от прибора с наибольшим водоотведением (q0_s). Второе — не сумма
        и не среднее: по формуле (5) прибавляется расход ОДНОГО прибора, самого
        мощного по стокам. В квартире это унитаз со смывным бачком, 1,6 л/с.
    */
    function fixtureSet(items) {
        var count = 0;
        var q0Sewer = 0;
        var worst = null;

        if (!items) return { count: 0, q0Sewer: 0, worst: null };

        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var n = Math.max(0, Math.round(item.count || 0));
            if (n === 0) continue;

            count += n;

            var fixture = Tables.fixture(item.name);
            if (fixture && fixture.qs > q0Sewer) {
                q0Sewer = fixture.qs;
                worst = fixture.name;
            }
        }

        return { count: count, q0Sewer: q0Sewer, worst: worst };
    }

    /*
        Раскладка стояка по этажам: что стоит на каждом этаже.

        Возвращает массив снизу вверх, где индекс 0 — первый этаж. Этаж, не
        накрытый ни одним участком, остаётся пустым: приборов на нём нет, и в
        накоплении он ничего не добавляет. Это не ошибка — так выглядит этаж, на
        котором стояк проходит транзитом.

        Перекрытие участков разрешается в пользу ПОСЛЕДНЕГО: правка «с 17 по 25
        теперь шесть приборов» поверх участка «с 1 по 25» должна срабатывать без
        того, чтобы сначала подрезать первый.
    */
    function layout(input) {
        var sections = input.sections || [];
        var top = 0;
        var i, f;

        for (i = 0; i < sections.length; i++) {
            var to = Math.max(number(sections[i].from), number(sections[i].to));
            if (to > top) top = to;
        }

        if (top === 0) return [];

        var floors = [];

        for (f = 0; f < top; f++) {
            floors.push({ floor: f + 1, fixtures: 0, residents: 0, q0Sewer: 0, worst: null });
        }

        for (i = 0; i < sections.length; i++) {
            var section = sections[i];
            var from = Math.max(1, Math.min(number(section.from), number(section.to)));
            var last = Math.max(number(section.from), number(section.to));

            var set = fixtureSet(section.fixtures);

            for (f = from; f <= last; f++) {
                var floor = floors[f - 1];

                floor.fixtures = set.count;
                floor.residents = Math.max(0, Math.round(section.residents || 0));
                floor.q0Sewer = set.q0Sewer;
                floor.worst = set.worst;
            }
        }

        return floors;
    }

    function number(value) {
        var parsed = parseInt(value, 10);
        return isFinite(parsed) && parsed > 0 ? parsed : 0;
    }

    /*
        Итоги по стояку: сколько всего приборов и жильцов и какой прибор задаёт
        прибавку по формуле (5).

        Прибор с наибольшим водоотведением ищется по всему стояку, а не по
        участку: залповый сброс может случиться на любом этаже, и в расчётное
        сечение у основания он придёт одинаково.
    */
    function totals(floors) {
        var fixtures = 0;
        var residents = 0;
        var q0Sewer = 0;
        var worst = null;

        for (var i = 0; i < floors.length; i++) {
            fixtures += floors[i].fixtures;
            residents += floors[i].residents;

            if (floors[i].q0Sewer > q0Sewer) {
                q0Sewer = floors[i].q0Sewer;
                worst = floors[i].worst;
            }
        }

        return { fixtures: fixtures, residents: residents, q0Sewer: q0Sewer, worst: worst };
    }

    /* Приборы и жильцы на этаже f и всех вышележащих. */
    function above(floors, f) {
        var fixtures = 0;
        var residents = 0;

        for (var i = f - 1; i < floors.length; i++) {
            fixtures += floors[i].fixtures;
            residents += floors[i].residents;
        }

        return { fixtures: fixtures, residents: residents };
    }

    /*
        Расчёт по потребителям: на каждом этаже своя вероятность по формуле (3).
    */
    function byUsers(input, floors, sum, result, trace) {
        var top = floors.length;

        // Сверху вниз: первой строкой идёт верхний этаж, последней — основание.
        for (var f = top; f >= 1; f--) {
            var carried = above(floors, f);

            var group = {
                name: f === 1 ? 'основание стояка' : 'этаж ' + f,
                norm: input.norm,
                users: carried.residents,
                fixtures: carried.fixtures,
                fixturesHot: carried.fixtures,
                q0Sewer: sum.q0Sewer
            };

            var flow = Demand.run(group, input.node);

            result.floors.push({
                floor: f,
                above: top - f + 1,
                fixtures: carried.fixtures,
                residents: carried.residents,
                P: flow.total.P,
                NP: flow.total.NP,
                alpha: flow.total.alpha,
                table: flow.total.table,
                q: flow.total.q,
                qs: flow.sewer,
                result: flow
            });
        }

        var base = result.floors[result.floors.length - 1];
        result.P = base.P;
        result.NP = base.NP;

        // Разбор пишем по основанию стояка — по расчётному сечению.
        var lines = base.result.trace.lines;
        for (var i = 0; i < lines.length; i++) trace.lines.push(lines[i]);
    }

    /*
        Расчёт по приборам: вероятность одна на стояк, по этажам растёт только N.

        Жильцы здесь нужны ровно один раз — чтобы получить P. Дальше этаж от
        этажа отличается только числом приборов, и это то самое «суммируем не
        жильцов, а приборы».
    */
    function byFixtures(input, floors, sum, result, trace) {
        var norm = input.norm;
        var top = floors.length;

        result.P = Demand.probability(norm, result.totalUsers, result.totalFixtures);
        result.NP = result.totalFixtures * result.P;

        trace.section('Вероятность действия приборов — одна на стояк');
        trace.note('Приборов на стояке всего N = ' + result.totalFixtures
            + (input.totalFixtures > 0 ? ' (задано)' : ' — по раскладке этажей'));
        trace.note('Потребителей на стояке всего U = ' + result.totalUsers
            + (input.totalUsers > 0 ? ' (задано)' : ' — по раскладке этажей'));

        trace.formula('P', 'q_hr,u · U / (3600 · q0 · N)',
            Format.num(norm.qhru) + ' · ' + result.totalUsers + ' / (3600 · '
            + Format.num(norm.q0) + ' · ' + result.totalFixtures + ')', result.P, '');

        trace.formula('N·P', 'N · P',
            result.totalFixtures + ' · ' + Format.num(result.P), result.NP, '');

        trace.note('Дальше по этажам меняется только число приборов: вероятность '
            + 'действия приборов на верхнем этаже та же, что у основания.');

        for (var f = top; f >= 1; f--) {
            var carried = above(floors, f);
            var flow = Demand.byFixtures(norm.q0, carried.fixtures, result.P, input.node, null);

            result.floors.push({
                floor: f,
                above: top - f + 1,
                fixtures: carried.fixtures,
                residents: carried.residents,
                P: result.P,
                NP: flow.NP,
                alpha: flow.alpha,
                table: flow.table,
                q: flow.q,
                qs: Demand.sewer(flow.q, sum.q0Sewer, null),
                result: null
            });
        }

        var base = result.floors[result.floors.length - 1];

        trace.section('Основание стояка — расчётное сечение');
        trace.note('Приборов на этом и вышележащих этажах N = ' + base.fixtures);

        Demand.byFixtures(norm.q0, base.fixtures, result.P, input.node, trace);
        Demand.sewer(base.q, sum.q0Sewer, trace);
    }

    /*
        ДВА СПОСОБА ВЕСТИ РАСЧЁТ — и они не равнозначны.

        «По потребителям» (галочка снята). На каждом этаже вероятность действия
        приборов вычисляется заново: берутся жильцы и приборы этого этажа и всех
        вышележащих, и по формуле (3) получается своя P. Пока этажи типовые,
        жильцы и приборы растут пропорционально, и P выходит одинаковой на всех
        этажах — но считается она каждый раз.

        «По приборам» (галочка стоит). Вероятность определяется ОДИН РАЗ по
        стояку в целом — по общему числу приборов и общему числу жильцов, — и
        дальше по этажам меняется только N:

            N·P (общее)  →  P = N·P / N  →  по этажам N_f · P → α → q

        Так и считают руками, и так честнее: вероятность действия приборов —
        свойство всего дома, а не отдельного этажа. Верхняя квартира не живёт по
        своим правилам оттого, что под ней нет других.

        Расходятся способы там, где стояк неравномерен: разные наборы приборов
        по участкам, двухуровневые квартиры наверху, встройка внизу, или P взята
        из расчёта по зданию целиком. Для таких случаев в режиме «по приборам»
        общие N и U можно задать прямо, а не выводить из раскладки.

        input:
          norm            — норма по таблице А.2
          sections        — участки: [{from, to, residents, fixtures:[{name,count}]}]
          floorHeightM    — высота этажа, м
          byFixtures      — вести расчёт по приборам
          totalFixtures   — приборов на стояке всего; 0 — считать по раскладке
          totalUsers      — потребителей на стояке всего; 0 — считать по раскладке
          vented          — стояк вентилируемый
          material        — ПВХ, ПП, чугун, SML
          riserMm         — диаметр стояка
          branchMm        — диаметр поэтажного отвода
          angleDeg        — угол присоединения отвода
          node            — снимать α по ближайшему большему узлу таблицы
    */
    function run(input) {
        var floors = layout(input);
        var sum = totals(floors);

        var result = {
            input: input,
            set: sum,
            layout: floors,
            byFixtures: !!input.byFixtures,
            floors: [],
            base: null,
            top: floors.length,
            totalFixtures: 0,
            totalUsers: 0,
            P: 0,
            NP: 0,
            capacity: 0,
            capacitySource: '',
            heightM: floors.length * input.floorHeightM,
            load: 0,
            passes: false,
            trace: new Demand.Trace()
        };

        var trace = result.trace;

        result.totalFixtures = input.byFixtures && input.totalFixtures > 0
            ? Math.round(input.totalFixtures)
            : sum.fixtures;

        result.totalUsers = input.byFixtures && input.totalUsers > 0
            ? Math.round(input.totalUsers)
            : sum.residents;

        trace.section('Стояк ' + (input.mark || '') + ' — исходные данные');
        trace.note('Способ расчёта: '
            + (input.byFixtures
                ? 'по приборам — вероятность определяется один раз по стояку в целом'
                : 'по потребителям — вероятность вычисляется на каждом этаже'));
        trace.note('Норма по таблице А.2: ' + input.norm.name);
        trace.note('Этажей на стояке: ' + result.top
            + ', высота этажа ' + Format.num(input.floorHeightM) + ' м, высота стояка '
            + Format.num(result.heightM) + ' м');

        var sections = input.sections || [];
        for (var s = 0; s < sections.length; s++) {
            var set = fixtureSet(sections[s].fixtures);

            trace.note('Этажи с ' + sections[s].from + ' по ' + sections[s].to
                + ': приборов на этаже ' + set.count
                + ', жильцов на этаж ' + sections[s].residents);
        }

        trace.note('Всего по стояку: приборов ' + sum.fixtures + ', жильцов ' + sum.residents);
        trace.note('Прибор с наибольшим водоотведением: '
            + (sum.worst || 'не выбран') + ', q0_s = ' + Format.num(sum.q0Sewer) + ' л/с');
        trace.note('Стояк: ' + input.material + ' ' + Format.diameter(input.riserMm)
            + ', поэтажный отвод ' + Format.diameter(input.branchMm)
            + ' под ' + Format.angle(input.angleDeg)
            + (input.vented ? ', вентилируемый' : ', невентилируемый'));

        var enough = sum.fixtures > 0 && result.top > 0
            && (input.byFixtures
                ? result.totalFixtures > 0 && result.totalUsers > 0
                : sum.residents > 0);

        if (!enough) {
            trace.note('Расчёт не выполнен: не заданы приборы, потребители или этажи.');
            return result;
        }

        if (input.byFixtures) byFixtures(input, floors, sum, result, trace);
        else byUsers(input, floors, sum, result, trace);

        result.base = result.floors[result.floors.length - 1];

        var capacity = Tables.capacity(input.vented, input.material, input.riserMm,
            input.branchMm, input.angleDeg, result.heightM);

        result.capacity = capacity.value;
        result.capacitySource = capacity.source;

        trace.section('Проверка на срыв гидрозатворов (8.3.3)');

        if (!(capacity.value > 0)) {
            trace.note('Пропускная способность не определена: ' + capacity.source
                + '. Проверить стояк не по чему — выберите исполнение, которое есть в '
                + 'приложении К, либо допишите строку в js\\sp30-data.js.');
            return result;
        }

        result.load = result.base.qs / capacity.value;
        result.passes = result.base.qs <= capacity.value;

        trace.note('Пропускная способность q_К = ' + Format.num(capacity.value)
            + ' л/с — ' + capacity.source);

        trace.formula('q_s / q_К', 'загрузка стояка',
            Format.num(result.base.qs) + ' / ' + Format.num(capacity.value),
            result.load, '');

        if (result.passes) {
            trace.note('q_s = ' + Format.num(result.base.qs) + ' л/с ≤ q_К = '
                + Format.num(capacity.value) + ' л/с — стояк проходит, разрежение в нём '
                + 'гидрозатворы не срывает.');
        } else {
            trace.note('q_s = ' + Format.num(result.base.qs) + ' л/с > q_К = '
                + Format.num(capacity.value) + ' л/с — стояк НЕ проходит: разрежение '
                + 'сорвёт гидрозатворы. Нужен больший диаметр, меньший угол '
                + 'присоединения отводов, вытяжная часть либо разделение стояка.');
        }

        return result;
    }

    /*
        Расход стоков у основания стояка, надстроенного до заданной этажности.

        Надстройка идёт ВЕРХНИМ участком: этажи добавляются такими же, как самые
        верхние, — так и растёт дом. Нужно для двух вопросов: до какого этажа
        проходит исполнение и какие исполнения проходят.
    */
    function flowAt(input, floors, sum, top) {
        var fixtures = 0;
        var residents = 0;
        var i;

        for (i = 0; i < Math.min(top, floors.length); i++) {
            fixtures += floors[i].fixtures;
            residents += floors[i].residents;
        }

        // Этажи сверх раскладки повторяют верхний.
        if (top > floors.length && floors.length) {
            var last = floors[floors.length - 1];
            var extra = top - floors.length;

            fixtures += last.fixtures * extra;
            residents += last.residents * extra;
        }

        if (!(fixtures > 0)) return 0;

        if (input.byFixtures) {
            var totalFixtures = input.totalFixtures > 0
                ? Math.round(input.totalFixtures)
                : fixtures;

            var totalUsers = input.totalUsers > 0
                ? Math.round(input.totalUsers)
                : residents;

            var P = Demand.probability(input.norm, totalUsers, totalFixtures);
            var flow = Demand.byFixtures(input.norm.q0, fixtures, P, input.node, null);

            return Demand.sewer(flow.q, sum.q0Sewer, null);
        }

        return Demand.run({
            norm: input.norm,
            users: residents,
            fixtures: fixtures,
            fixturesHot: fixtures,
            q0Sewer: sum.q0Sewer
        }, input.node).sewer;
    }

    /*
        Сколько этажей выдержит стояк в заданном исполнении.

        Вопрос, который инженер задаёт вторым: не «проходит ли», а «до какого
        этажа проходит». Считаем наращиванием этажей, а не формулой: обратной
        зависимости у таблиц Б нет, а перебор до сотни этажей мгновенен.
    */
    function limitFloors(input, maxFloors) {
        var floors = layout(input);
        var sum = totals(floors);

        if (!(sum.fixtures > 0)) return 0;

        var limit = maxFloors || 50;

        var capacity = Tables.capacity(input.vented, input.material, input.riserMm,
            input.branchMm, input.angleDeg, limit * input.floorHeightM);

        if (!(capacity.value > 0)) return 0;

        for (var top = 1; top <= limit; top++) {
            /*
                У невентилируемого стояка пропускная способность падает с
                высотой, поэтому её берём на ту высоту, которая получится при
                этом числе этажей, а не на заданную.
            */
            var atHeight = Tables.capacity(input.vented, input.material, input.riserMm,
                input.branchMm, input.angleDeg, top * input.floorHeightM);

            if (flowAt(input, floors, sum, top) > atHeight.value) return top - 1;
        }

        return limit;
    }

    /*
        Исполнения стояка, которые проходят при том же расходе.

        Показывается, когда заданное не прошло: инженеру нужен не отказ, а
        список того, что сделать. Перебираются материалы, диаметры, отводы и
        углы из самого приложения К — выдумывать нечего.
    */
    function alternatives(input) {
        var floors = layout(input);
        var sum = totals(floors);

        if (!(sum.fixtures > 0)) return [];

        var qs = flowAt(input, floors, sum, floors.length);
        var height = floors.length * input.floorHeightM;
        var found = [];

        var ventedModes = [true, false];

        for (var v = 0; v < ventedModes.length; v++) {
            var vented = ventedModes[v];
            var materials = Tables.materials(vented);

            for (var m = 0; m < materials.length; m++) {
                var material = materials[m];
                var options = Tables.stackOptions(vented, material);

                for (var r = 0; r < options.risers.length; r++) {
                    for (var b = 0; b < options.branches.length; b++) {
                        for (var a = 0; a < options.angles.length; a++) {
                            // Отвод крупнее стояка — исполнения не существует.
                            if (options.branches[b] > options.risers[r]) continue;

                            var capacity = Tables.capacity(vented, material,
                                options.risers[r], options.branches[b],
                                options.angles[a], height);

                            if (!(capacity.value >= qs)) continue;

                            found.push({
                                vented: vented,
                                material: material,
                                riserMm: options.risers[r],
                                branchMm: options.branches[b],
                                angleDeg: options.angles[a],
                                capacity: capacity.value,
                                load: qs / capacity.value
                            });
                        }
                    }
                }
            }
        }

        // Сначала самые нагруженные из проходящих: они и есть экономичные.
        found.sort(function (x, y) { return y.load - x.load; });

        return found;
    }

    return {
        run: run,
        fixtureSet: fixtureSet,
        layout: layout,
        totals: totals,
        limitFloors: limitFloors,
        alternatives: alternatives
    };
})();
