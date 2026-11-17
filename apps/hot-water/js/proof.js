'use strict';

/*
    Проверочный расчёт: как расход разойдётся сам.

    Основной расчёт отвечает на вопрос «сколько нужно», чтобы у дальнего
    потребителя было 60 °C. Он назначает расходы кольцам и показывает, какими
    клапанами эти расходы удержать. Вода при этом ни о каких 60 °C не знает:
    она идёт туда, где меньше сопротивление.

    Здесь считается именно это — потокораспределение. Задаётся расход на ИТП,
    а программа находит, как он поделится между кольцами, чтобы выполнялись
    два условия:

      1. сумма контурных расходов равна заданному расходу на ИТП;
      2. перепад по каждому кольцу одинаков и равен напору насоса —
         иначе вода перетекла бы из кольца в кольцо.

    Второе условие — это второй закон Кирхгофа. Все кольца начинаются и
    заканчиваются в одном месте, в ИТП, поэтому потери по любому из них равны
    одному и тому же напору.

    Задача нелинейная: потери растут примерно как квадрат расхода. Решается
    Ньютоном по контурным расходам — тем же методом, что и увязка колец вручную,
    только автоматически. Поправка кольца выводится из линеаризации:

        ΔQ_i = (H − F_i) / D_i,   D_i = Σ 2·Δp_j/|G_j|

    а общий напор H берётся таким, чтобы сумма поправок была нулевой —
    тогда заданный расход на ИТП не уедет.

    СХЕМА И РЕЗУЛЬТАТЫ ОСНОВНОГО РАСЧЁТА НЕ МЕНЯЮТСЯ. Решатель работает
    на тех же объектах, но всё, что он трогает, сохраняется до и возвращается
    после. Это проверяется тестом: после проверочного расчёта числа основного
    обязаны остаться прежними.
*/

var ProofSolver = (function () {

    var MAX_STEPS = 300;
    var TEMPERATURE_ROUNDS = 15;

    /*
        Допуск сходимости: во сколько раз разброс перепадов по кольцам должен
        стать меньше самого напора.

        Миллионная доля — это запас на пять порядков против всего, что в расчёте
        вообще имеет смысл: перепады выдаются с точностью до паскаля, а сами
        исходные данные — длины, шероховатость, теплопотери — известны
        процентами. Требовать большего нельзя не из лени: у коэффициента трения
        на границе ламинарного режима излом, и около него разброс упирается
        в предел, ниже которого не опускается никаким дроблением шага.
        Прежний допуск 1e-9 именно туда и попадал, и трёхкольцевая сеть
        без клапанов объявлялась несошедшейся, будучи сошедшейся давно.
    */
    var TOLERANCE = 1e-6;

    /* --- сохранение и возврат состояния --------------------------------- */

    var SEGMENT_FIELDS = ['flow', 'flowDirection', 'velocity', 'pipeDrop', 'valveDrop',
                          'pressureDrop', 'temperatureIn', 'temperatureOut',
                          'heatLoss', 'heatFluxPerMetre', 'ambientTemperature', 'alpha'];

    function save(network) {
        var kept = { segments: [], nodes: [] };
        var i, k;

        for (i = 0; i < network.segments.length; i++) {
            var one = {};
            for (k = 0; k < SEGMENT_FIELDS.length; k++)
                one[SEGMENT_FIELDS[k]] = network.segments[i][SEGMENT_FIELDS[k]];
            kept.segments.push(one);
        }

        for (i = 0; i < network.nodes.length; i++)
            kept.nodes.push(network.nodes[i].temperature);

        return kept;
    }

    function restore(network, kept) {
        var i, k;

        for (i = 0; i < network.segments.length; i++) {
            for (k = 0; k < SEGMENT_FIELDS.length; k++)
                network.segments[i][SEGMENT_FIELDS[k]] = kept.segments[i][SEGMENT_FIELDS[k]];
        }

        for (i = 0; i < network.nodes.length; i++)
            network.nodes[i].temperature = kept.nodes[i];
    }

    /* --- потокораспределение -------------------------------------------- */

    /**
     * Потери на участке при заданном расходе, Па, с клапаном заданного Kv.
     *
     * Kv приходит готовым числом, а не берётся из участка: он зависит от того,
     * какой прогон идёт — с клапанами, без них или с положением, выставленным
     * вручную. Ноль означает «клапана нет вовсе».
     */
    function lossAt(segment, flowKgPerHour, settings, kv) {
        var g = Math.abs(flowKgPerHour);
        if (g <= 1e-9) return 0.0;

        var drop = Hydraulics.detail(g, segment.length, segment.innerDiameter,
                                     segment.material, settings).total;

        if (kv > 1e-9)
            drop += Balancing.dropForKv(g, kv);

        return drop;
    }

    /**
     * Производная потерь по расходу, Па/(кг/ч).
     *
     * Считается численно, малым приращением, а не по формуле 2·Δp/G.
     *
     * Формула 2·Δp/G верна, когда потери растут ровно как квадрат расхода, —
     * то есть в квадратичной области, где λ от расхода уже не зависит.
     * В циркуляции же половина участков сидит в переходной области, и там λ
     * сам растёт с расходом: потери идут круче квадрата, настоящая производная
     * больше, а Ньютон с заниженной производной перелетает цель и начинает
     * качаться. На двух кольцах это стоило сорока лишних шагов.
     *
     * Приращение в тысячную долю: меньше — и разность утонет в точности
     * double, больше — и сама разность перестанет быть производной.
     */
    function slopeAt(segment, flowKgPerHour, settings, kv, known) {
        var g = Math.abs(flowKgPerHour);
        if (g <= 1e-9) return 0.0;

        var step = g * 1e-3;
        var ahead = lossAt(segment, g + step, settings, kv);

        return (ahead - known) / step;
    }

    /**
     * Kv каждого участка для этого прогона.
     *
     * Три случая, и различать их надо именно так:
     *
     *   — клапанов нет вовсе: Kv = 0, сопротивление только трубы. Так считается
     *     столбец «без клапанов».
     *   — клапан настроен расчётом: берётся actualKv, подобранный основным
     *     расчётом.
     *   — положение задано вручную: Kv считается по шкале этой модели.
     *     Полностью открытый клапан — это НЕ отсутствие клапана: открытый
     *     он всё равно сопротивляется своим наибольшим Kv, и разница между
     *     этими двумя случаями в сетях ГВС бывает заметной.
     */
    function kvTable(network, rings, useValves, positions) {
        var kv = new Float64Array(network.segments.length);
        var used = {};

        if (!useValves) return { kv: kv, used: used };

        for (var i = 0; i < network.segments.length; i++) {
            var valve = network.segments[i].valve;
            kv[i] = valve && valve.actualKv > 1e-9 ? valve.actualKv : 0.0;
        }

        for (i = 0; i < rings.length; i++) {
            var ring = rings[i];
            var asked = positions ? positions[ring.index] : undefined;

            if (asked === undefined || asked === null || asked === '')
                continue;
            if (ring.valveSegment < 0)
                continue;

            var segment = network.segments[ring.valveSegment];
            var model = segment.valve ? segment.valve.model : null;

            if (!model) continue;

            var limit = ValveCatalog.fullOpen(model);
            var position = asked === 'full'
                ? limit
                : parseFloat(String(asked).replace(',', '.'));

            if (!isFinite(position)) continue;

            /*
                Положение приводится к шкале этой модели: за её пределы ручка
                не поворачивается, и промежуточных делений на ней нет.
                Об усечении сообщается — молча подменять заданное число
                нельзя, человек его проверяет.
            */
            var clamped = position < 0.0 || position > limit;
            if (position < 0.0) position = 0.0;
            if (position > limit) position = limit;
            position = ValveCatalog.roundPosition(model, position);

            kv[ring.valveSegment] = ValveCatalog.kvAt(model, position);

            used[ring.index] = {
                position: position,
                text: ValveCatalog.formatPosition(model, position),
                kv: kv[ring.valveSegment],
                full: position >= limit - 1e-9,
                clamped: clamped,
                limit: limit,
                asked: String(asked)
            };
        }

        return { kv: kv, used: used };
    }

    /**
     * Связь двух колец, Па/(кг/ч): производная перепада кольца i по расходу
     * кольца j.
     *
     * Складывается по участкам, через которые проходят ОБА кольца. Для i = j
     * это сумма производных по всем своим участкам — то, что раньше было
     * единственным учитываемым членом. Для i ≠ j это общая магистраль:
     * знаки обхода у двух колец на ней могут и совпадать, и нет, поэтому
     * перемножаются.
     *
     * Кольца редко бывают длинными, и перебор участка по участку обходится
     * дешевле, чем заводить общий словарь: на восьми стояках это несколько
     * сотен сравнений на шаг.
     */
    function coupling(rings, directions, slope, i, j) {
        var sum = 0.0;
        var own = rings[i].segments;
        var other = rings[j].segments;

        for (var a = 0; a < own.length && a < directions[i].length; a++) {
            var index = own[a];

            for (var b = 0; b < other.length && b < directions[j].length; b++) {
                if (other[b] !== index) continue;
                sum += directions[i][a] * directions[j][b] * slope[index];
                break;
            }
        }

        return sum;
    }

    /**
     * Решение системы линейных уравнений методом Гаусса с выбором главного
     * элемента по столбцу. Матрица передаётся расширенной: последний столбец —
     * правая часть. Возвращает null, если система вырождена.
     *
     * Выбор главного элемента здесь не роскошь: в строке напора стоят единицы,
     * а в строках колец — производные порядка 1e4, и без перестановки строк
     * деление на малое ведущее число съедает точность.
     */
    function solveLinear(matrix, size) {
        var i, j, k;

        for (i = 0; i < size; i++) {
            var pivot = i;
            for (k = i + 1; k < size; k++) {
                if (Math.abs(matrix[k][i]) > Math.abs(matrix[pivot][i]))
                    pivot = k;
            }

            if (Math.abs(matrix[pivot][i]) < 1e-14)
                return null;

            if (pivot !== i) {
                var swap = matrix[i];
                matrix[i] = matrix[pivot];
                matrix[pivot] = swap;
            }

            var lead = matrix[i][i];
            for (k = i + 1; k < size; k++) {
                var factor = matrix[k][i] / lead;
                if (factor === 0.0) continue;

                for (j = i; j <= size; j++)
                    matrix[k][j] -= factor * matrix[i][j];
            }
        }

        var answer = new Float64Array(size);
        for (i = size - 1; i >= 0; i--) {
            var rest = matrix[i][size];
            for (j = i + 1; j < size; j++)
                rest -= matrix[i][j] * answer[j];

            answer[i] = rest / matrix[i][i];
        }

        for (i = 0; i < size; i++) {
            if (!isFinite(answer[i])) return null;
        }

        return answer;
    }

    /**
     * Расходы колец при заданном расходе на ИТП.
     * Возвращает контурные расходы, напор и то, сошлось ли.
     */
    function distribute(network, settings, rings, directions, total, kvOf) {
        var count = rings.length;
        var flows = new Float64Array(count);
        var i, k;

        if (count === 0 || total <= 1e-9)
            return { flows: flows, head: 0.0, steps: 0, converged: true };

        // Начальное приближение — расчётные расходы, приведённые к заданной сумме.
        // Они уже близки к ответу, и итерация стартует не с пустого места.
        var start = 0.0;
        for (i = 0; i < count; i++) start += Math.max(rings[i].flow, 0.0);

        for (i = 0; i < count; i++) {
            flows[i] = start > 1e-9
                ? total * Math.max(rings[i].flow, 0.0) / start
                : total / count;
        }

        var signed = new Float64Array(network.segments.length);
        var loss = new Float64Array(network.segments.length);
        var slope = new Float64Array(network.segments.length);

        var head = 0.0;
        var steps = 0;
        var converged = false;
        /*
            Полный шаг Ньютона: система решается целиком, и урезать его
            незачем. Дробление включается только если шаг перестал помогать —
            у излома коэффициента трения на границе ламинарного режима это
            случается.
        */
        var damping = 1.0;

        /*
            best — наименьший достигнутый разброс, он уходит в отчёт: если
            сходимости не вышло, человек должен видеть, насколько не вышло.
            improved — то же число, но для управления шагом: по нему решается,
            пора ли дробить шаг.
        */
        var best = Infinity;
        var improved = Infinity;
        var stalled = 0;

        for (; steps < MAX_STEPS; steps++) {
            // Расход участка — алгебраическая сумма контурных расходов колец,
            // через него проходящих. Та же сборка, что и в основном расчёте.
            for (i = 0; i < signed.length; i++) signed[i] = 0.0;

            for (i = 0; i < count; i++) {
                for (k = 0; k < rings[i].segments.length && k < directions[i].length; k++)
                    signed[rings[i].segments[k]] += directions[i][k] * flows[i];
            }

            for (i = 0; i < network.segments.length; i++) {
                var g = Math.abs(signed[i]);
                loss[i] = lossAt(network.segments[i], g, settings, kvOf[i]);
                slope[i] = slopeAt(network.segments[i], g, settings, kvOf[i], loss[i]);
            }

            // Невязка по кольцу и её производная по собственному расходу.
            var residual = new Float64Array(count);
            var derivative = new Float64Array(count);

            for (i = 0; i < count; i++) {
                var sumF = 0.0;
                var sumD = 0.0;

                for (k = 0; k < rings[i].segments.length && k < directions[i].length; k++) {
                    var index = rings[i].segments[k];
                    var direction = signed[index] >= 0 ? 1 : -1;

                    sumF += directions[i][k] * loss[index] * direction;
                    sumD += slope[index];
                }

                residual[i] = sumF;
                derivative[i] = sumD > 1e-12 ? sumD : 1e-12;
            }

            /*
                Общий напор: средневзвешенное первого приближения. Дальше его
                поправляет сам Ньютон — напор здесь такая же неизвестная,
                как расходы колец.
            */
            if (steps === 0) {
                var weighted = 0.0;
                var weights = 0.0;

                for (i = 0; i < count; i++) {
                    weighted += residual[i] / derivative[i];
                    weights += 1.0 / derivative[i];
                }

                head = weights > 1e-12 ? weighted / weights : 0.0;
            }

            /*
                Невязка по кольцам — то, что на самом деле надо обнулить:
                перепады по всем кольцам обязаны сравняться. По ней и судим
                о сходимости, а не по изменению расходов: расход может топтаться
                на месте, пока невязка ещё велика.
            */
            var high = residual[0];
            var low = residual[0];
            for (i = 1; i < count; i++) {
                if (residual[i] > high) high = residual[i];
                if (residual[i] < low) low = residual[i];
            }

            var spread = Math.abs(head) > 1e-12 ? (high - low) / Math.abs(head) : high - low;

            if (spread < best) best = spread;
            if (spread < TOLERANCE) { converged = true; steps++; break; }

            /*
                На границе ламинарного и турбулентного режимов λ меняется
                скачком, и шаг постоянной величины вокруг этой границы
                зацикливается: расход перепрыгивает её туда-обратно.
                Поэтому шаг уменьшается, как только невязка перестаёт убывать.
            */
            if (spread < improved * 0.999) {
                improved = spread;
                stalled = 0;
            } else if (++stalled >= 5) {
                damping *= 0.5;
                stalled = 0;
                if (damping < 1e-4) break;
            }

            /*
                Поправки — из полной линеаризованной системы, а не по диагонали.

                Кольца связаны общими участками: по магистрали от ИТП идёт вода
                всех колец сразу, и, добавив расход одному, меняешь перепад
                у всех остальных. Пока колец два-три, этой связью можно
                пренебречь, и шаг «своя невязка делить на свою производную»
                работает. На восьми стояках с общей магистралью связь становится
                сильнее собственного сопротивления стояка: шаг перелетает цель,
                решатель начинает качаться, дробление шага его только
                останавливает — и останавливает, не дойдя. Так и было:
                перепады колец расходились на 5 % от напора.

                Поэтому решается система целиком. Неизвестных count + 1:
                расходы колец и сам напор. Уравнения — перепад каждого кольца
                равен напору, а сумма расходов равна заданному на ИТП.
            */
            var size = count + 1;
            var matrix = [];

            for (i = 0; i < size; i++) {
                var line = new Float64Array(size + 1);
                matrix.push(line);
            }

            // Перепад кольца равен напору: Σ J_ij·ΔQ_j − ΔH = H − F_i.
            for (i = 0; i < count; i++) {
                for (var j = 0; j < count; j++)
                    matrix[i][j] = coupling(rings, directions, slope, i, j);

                matrix[i][count] = -1.0;
                matrix[i][size] = head - residual[i];
            }

            // Сумма расходов равна заданной: Σ ΔQ_j = total − ΣQ.
            var current = 0.0;
            for (i = 0; i < count; i++) {
                matrix[count][i] = 1.0;
                current += flows[i];
            }
            matrix[count][count] = 0.0;
            matrix[count][size] = total - current;

            var step = solveLinear(matrix, size);

            var worst = 0.0;
            for (i = 0; i < count; i++) {
                /*
                    Система может оказаться вырожденной — например, когда одно
                    из колец встало и производная у него нулевая. Тогда берётся
                    прежний диагональный шаг: он грубее, но считает всегда.
                */
                var change = step
                    ? damping * step[i]
                    : damping * (head - residual[i]) / derivative[i];

                var next = flows[i] + change;

                // Кольцо может почти остановиться, но повернуть вспять оно
                // не должно: встречной циркуляции через ИТП не бывает.
                if (next < 0.0) next = 0.0;

                var relative = Math.abs(next - flows[i]) / Math.max(flows[i], 1e-6);
                if (relative > worst) worst = relative;

                flows[i] = next;
            }

            if (step) head += damping * step[count];

            // Обрезка отрицательных могла сбить сумму — возвращаем её на место.
            var sum = 0.0;
            for (i = 0; i < count; i++) sum += flows[i];

            if (sum > 1e-9) {
                var scale = total / sum;
                for (i = 0; i < count; i++) flows[i] *= scale;
            }

            // Расходы замерли, а невязка ещё велика — дальше идти некуда.
            if (worst < 1e-12) { steps++; break; }
        }

        return {
            flows: flows, head: head, steps: steps,
            converged: converged,
            spread: best === Infinity ? 0.0 : best
        };
    }

    /* --- температуры при найденных расходах ----------------------------- */

    /**
     * Температуры в конце подающей части каждого кольца при этих расходах.
     * Ради них проверочный расчёт и затевается: если расход ушёл в ближнее
     * кольцо, дальнее не доберёт 60 °C, и видно это только по температуре.
     */
    function temperatures(network, settings, rings, directions, flows) {
        var i, k;
        var signed = new Float64Array(network.segments.length);

        for (i = 0; i < rings.length; i++) {
            for (k = 0; k < rings[i].segments.length && k < directions[i].length; k++)
                signed[rings[i].segments[k]] += directions[i][k] * flows[i];
        }

        for (i = 0; i < network.segments.length; i++) {
            var segment = network.segments[i];
            segment.flow = Math.abs(signed[i]);
            segment.flowDirection = signed[i] > 1e-9 ? 1 : (signed[i] < -1e-9 ? -1 : 0);
        }

        // Теплопотери и температуры связаны: остывая, вода теряет меньше.
        // Расходы при этом уже найдены и не меняются.
        for (var round = 0; round < TEMPERATURE_ROUNDS; round++) {
            FlowSolver.propagateTemperatures(network, settings);
            HeatLoss.apply(network, settings);
        }

        var ends = [];
        for (i = 0; i < rings.length; i++) {
            var far = rings[i].farNode >= 0
                ? rings[i].farNode
                : (rings[i].linkIndex >= 0 ? network.segments[rings[i].linkIndex].nodeA : -1);

            ends.push(far >= 0 ? network.nodes[far].temperature : 0.0);
        }

        return ends;
    }

    /* --- один прогон по зоне -------------------------------------------- */

    function runZone(network, settings, zone, total, useValves, positions) {
        var rings = [];
        for (var i = 0; i < zone.rings.length; i++) {
            var ring = network.rings[zone.rings[i]];
            if (ring.segments.length > 0) rings.push(ring);
        }

        if (rings.length === 0) return null;

        var table = kvTable(network, rings, useValves, positions);
        var directions = FlowSolver.buildDirections(network, rings);
        var solved = distribute(network, settings, rings, directions, total, table.kv);
        var ends = temperatures(network, settings, rings, directions, solved.flows);

        var perRing = [];
        for (i = 0; i < rings.length; i++) {
            // Перепад по кольцу при найденном расходе — он же напор насоса,
            // если кольцо самое невыгодное.
            var drop = 0.0;
            for (var k = 0; k < rings[i].segments.length; k++) {
                var index = rings[i].segments[k];
                drop += lossAt(network.segments[index], network.segments[index].flow,
                               settings, table.kv[index]);
            }

            var hand = table.used[rings[i].index] || null;
            var design = rings[i].valveSegment >= 0
                && network.segments[rings[i].valveSegment].valve
                ? network.segments[rings[i].valveSegment].valve : null;

            perRing.push({
                index: rings[i].index,
                number: rings[i].number,
                flow: solved.flows[i],
                share: total > 1e-9 ? solved.flows[i] / total : 0.0,
                endTemperature: ends[i],
                drop: drop,

                // Чем именно душили это кольцо в этом прогоне.
                valveKv: rings[i].valveSegment >= 0 ? table.kv[rings[i].valveSegment] : 0.0,
                position: hand ? hand.position : (design ? design.position : 0),
                positionText: hand ? hand.text
                    : (design && design.model
                        ? ValveCatalog.formatPosition(design.model, design.position) : '—'),
                byHand: !!hand,
                wideOpen: !!(hand && hand.full),
                clamped: !!(hand && hand.clamped),
                scaleLimit: hand ? hand.limit : 0,
                asked: hand ? hand.asked : null,
                designPosition: design && design.model
                    ? ValveCatalog.formatPosition(design.model, design.position) : '—',
                designKv: design ? design.actualKv : 0.0,
                valveCaption: design && design.model ? design.model.caption : '—',
                hasValve: !!design && design.actualKv > 1e-9
            });
        }

        return {
            rings: perRing, head: solved.head,
            steps: solved.steps, converged: solved.converged,
            spread: solved.spread
        };
    }

    return {
        /**
         * Проверочный расчёт по всем зонам.
         *
         * totals — заданные расходы на ИТП по ключу зоны, кг/ч. Чего нет
         * в этом списке, считается по расчётному расходу самой зоны.
         *
         * positions — настроечные положения клапанов по индексу кольца:
         * число или 'full' для полностью открытого. Чего нет в списке,
         * считается по положению, подобранному основным расчётом. Это ответ
         * на самый частый вопрос после наладки: «выставили не то, что будет».
         */
        run: function (network, settings, totals, positions) {
            var kept = save(network);
            var result = { zones: [], notes: [] };

            try {
                for (var i = 0; i < network.zones.length; i++) {
                    var zone = network.zones[i];
                    if (zone.rings.length === 0) continue;

                    var design = 0.0;
                    for (var k = 0; k < zone.rings.length; k++)
                        design += network.rings[zone.rings[k]].flow;

                    var asked = totals && totals[zone.key] > 0 ? totals[zone.key] : design;

                    var withValves = runZone(network, settings, zone, asked, true, positions);
                    var without = runZone(network, settings, zone, asked, false, null);

                    if (!withValves || !without) continue;

                    var byHand = 0;
                    for (k = 0; k < withValves.rings.length; k++)
                        if (withValves.rings[k].byHand) byHand++;

                    result.zones.push({
                        key: zone.key, caption: zone.caption,
                        design: design, total: asked,
                        given: !!(totals && totals[zone.key] > 0),
                        handPositions: byHand,
                        withValves: withValves, without: without
                    });

                    /*
                        Если не сошлось, надо сказать не только это, но и
                        насколько: разброс 1e-5 означает, что перепады колец
                        разошлись на тысячную долю процента, и числа годны,
                        а разброс 0,3 — что не годны вовсе. Без этой цифры
                        предупреждение одинаково пугает в обоих случаях.
                    */
                    if (!withValves.converged || !without.converged) {
                        var which = !withValves.converged ? withValves : without;

                        result.notes.push('Зона ' + zone.caption + ': распределение расхода '
                            + (!withValves.converged ? 'с клапанами ' : 'без клапанов ')
                            + 'остановилось на ' + which.steps + '-м шаге, не добрав допуска. '
                            + 'Перепады колец разошлись на '
                            + Fmt.fixed(which.spread * 100.0, 4) + ' % от напора '
                            + '(допуск ' + Fmt.fixed(TOLERANCE * 100.0, 4) + ' %). '
                            + (which.spread < 0.001
                                ? 'На инженерную точность это не влияет, но числа — '
                                    + 'последнее приближение.'
                                : 'Доверять этим числам нельзя.'));
                    }
                }
            } finally {
                // Что бы ни случилось, основной расчёт обязан остаться нетронутым.
                restore(network, kept);
            }

            return result;
        },

        /** Расчётный расход зоны, кг/ч — то, что подобрал основной расчёт. */
        designFlow: function (network, zone) {
            var total = 0.0;
            for (var i = 0; i < zone.rings.length; i++)
                total += network.rings[zone.rings[i]].flow;
            return total;
        }
    };
})();
