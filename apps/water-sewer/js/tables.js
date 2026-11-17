/*
    Разбор таблиц СП 30.13330.2020 и снятие с них значений.

    Таблицы приходят текстом из sp30-data.js. Здесь они превращаются в числа
    и отдаются расчёту: коэффициент alpha по приложению Б, расходы приборов по
    таблице А.1, нормы водопотребления по таблице А.2, пропускная способность
    канализационных стояков по приложению К.

    Разбор один на все таблицы: строка с решёткой — комментарий, пустая строка
    пропускается, колонки разделены табуляцией.
*/

var Tables = (function () {
    'use strict';

    /* --- разбор текста -------------------------------------------------- */

    function rows(text) {
        var out = [];
        var lines = String(text).split(/\r?\n/);

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var cut = line.indexOf('#');
            if (cut >= 0) line = line.substring(0, cut);

            line = line.replace(/\s+$/, '');
            if (line.length === 0) continue;

            var cells = line.split('\t');
            for (var c = 0; c < cells.length; c++) cells[c] = cells[c].trim();

            // Строка без табуляций — это не строка таблицы, а обрывок текста.
            if (cells.length < 2) continue;

            out.push(cells);
        }

        return out;
    }

    function num(cells, index, fallback) {
        if (index >= cells.length) return fallback;
        var value = parseFloat(String(cells[index]).replace(',', '.'));
        return isFinite(value) ? value : fallback;
    }

    /* --- Приложение Б: коэффициент alpha --------------------------------- */

    var b1 = null;   // { p: [...], n: [...], a: [[...]] }
    var b2 = null;   // { np: [...], a: [...] }

    function loadB1() {
        if (b1) return b1;

        var raw = rows(SP30.raw['B1']);
        var p = [];
        var n = [];
        var a = [];

        for (var i = 0; i < raw.length; i++) {
            var line = raw[i];

            if (line[0].toUpperCase() === 'P') {
                for (var c = 1; c < line.length; c++) p.push(num(line, c, 0));
                continue;
            }

            var count = num(line, 0, NaN);
            if (!isFinite(count)) continue;

            var values = [];
            for (var k = 1; k < line.length; k++) values.push(num(line, k, 0));

            n.push(count);
            a.push(values);
        }

        b1 = { p: p, n: n, a: a };
        return b1;
    }

    function loadB2() {
        if (b2) return b2;

        var raw = rows(SP30.raw['B2']);
        var np = [];
        var a = [];

        for (var i = 0; i < raw.length; i++) {
            var x = num(raw[i], 0, NaN);
            var y = num(raw[i], 1, NaN);
            if (!isFinite(x) || !isFinite(y)) continue;

            np.push(x);
            a.push(y);
        }

        b2 = { np: np, a: a };
        return b2;
    }

    /*
        Номер первого узла, который не меньше значения. Двоичным поиском:
        таблица Б.2 — шестьсот строк, а коэффициент снимается на каждом этаже
        каждого стояка.
    */
    function upper(nodes, value) {
        var low = 0;
        var high = nodes.length - 1;

        while (low < high) {
            var middle = (low + high) >> 1;
            if (nodes[middle] < value) low = middle + 1;
            else high = middle;
        }

        return low < 1 ? 1 : low;
    }

    /*
        Таблица Б.2 — по произведению N·P.

        За верхним краем таблицы продолжаем последним участком: отказаться было
        бы хуже, расчёт встал бы на большом комплексе, а зависимость там уже
        давно линейная.
    */
    function fromB2(np, node) {
        var t = loadB2();
        if (t.np.length === 0) return 0;

        if (np <= t.np[0]) return t.a[0];

        var last = t.np.length - 1;

        if (np >= t.np[last]) {
            var slope = (t.a[last] - t.a[last - 1]) / (t.np[last] - t.np[last - 1]);
            return t.a[last] + (np - t.np[last]) * slope;
        }

        var i = upper(t.np, np);
        if (node) return t.a[i];

        var k = (np - t.np[i - 1]) / (t.np[i] - t.np[i - 1]);
        return t.a[i - 1] + k * (t.a[i] - t.a[i - 1]);
    }

    /* Значение в строке таблицы Б.1 при вероятности P — вторая интерполяция. */
    function rowValue(row, p, node) {
        var t = loadB1();
        var cols = t.p.length;

        if (p <= t.p[0]) return t.a[row][0];
        if (p >= t.p[cols - 1]) return t.a[row][cols - 1];

        var j = upper(t.p, p);
        if (node) return t.a[row][j];

        var k = (p - t.p[j - 1]) / (t.p[j] - t.p[j - 1]);
        return t.a[row][j - 1] + k * (t.a[row][j] - t.a[row][j - 1]);
    }

    /*
        Таблица Б.1 — двойная интерполяция: сначала по числу приборов, потом по
        вероятности. Одной мало: таблица задана редкой сеткой по обеим осям.

        Ниже первой строки таблица не продолжается: N = 2 — её начало, а при
        одном приборе расход берётся по самому прибору, а не по alpha.
    */
    function fromB1(n, p, node) {
        var t = loadB1();
        if (t.n.length === 0) return 0;

        var rowsCount = t.n.length;

        if (n <= t.n[0]) return rowValue(0, p, node);
        if (n >= t.n[rowsCount - 1]) return rowValue(rowsCount - 1, p, node);

        var i = upper(t.n, n);
        if (node) return rowValue(i, p, node);

        var below = rowValue(i - 1, p, node);
        var above = rowValue(i, p, node);

        var k = (n - t.n[i - 1]) / (t.n[i] - t.n[i - 1]);
        return below + k * (above - below);
    }

    /*
        Правило выбора таблицы задано пунктом 5.3: таблицей Б.1 пользуются при
        P > 0,1 и N не больше 200, во всех прочих случаях — таблицей Б.2 по
        произведению N·P.

        Для жилых домов рабочей оказывается именно Б.2: вероятность там выходит
        порядка 0,007–0,03, то есть заведомо меньше 0,1.
    */
    function tableOf(n, p) {
        return (p > 0.1 && n <= 200) ? 'Б.1' : 'Б.2';
    }

    function alpha(n, p, node) {
        if (!(n > 0) || !(p > 0)) return 0;
        if (p > 0.1 && n <= 200) return fromB1(n, p, node);
        return fromB2(n * p, node);
    }

    /* --- Таблица А.1: приборы -------------------------------------------- */

    var fixtures = null;

    function loadFixtures() {
        if (fixtures) return fixtures;

        var raw = rows(SP30.raw['A1']);
        fixtures = [];

        for (var i = 0; i < raw.length; i++) {
            var line = raw[i];
            if (line.length < 9) continue;

            fixtures.push({
                name: line[0],
                q0: num(line, 1, 0),
                q0c: num(line, 2, 0),
                q0h: num(line, 3, 0),
                q0hr: num(line, 4, 0),
                q0hrc: num(line, 5, 0),
                q0hrh: num(line, 6, 0),
                qs: num(line, 7, 0),
                dy: num(line, 8, 0),
                dyo: num(line, 9, 0)
            });
        }

        return fixtures;
    }

    function fixture(name) {
        var list = loadFixtures();
        for (var i = 0; i < list.length; i++) {
            if (list[i].name === name) return list[i];
        }
        return null;
    }

    /* --- Таблица А.2: нормы водопотребления ------------------------------ */

    var norms = null;

    function loadNorms() {
        if (norms) return norms;

        var raw = rows(SP30.raw['A2']);
        norms = [];

        for (var i = 0; i < raw.length; i++) {
            var line = raw[i];
            if (line.length < 11) continue;

            var norm = {
                name: line[0],
                unit: line[1],
                qu: num(line, 2, 0),
                quh: num(line, 3, 0),
                qhru: num(line, 4, 0),
                qhruh: num(line, 5, 0),
                q0: num(line, 6, 0),
                q0hr: num(line, 7, 0),
                q0h: num(line, 8, 0),
                q0hrh: num(line, 9, 0),
                t: num(line, 10, 24)
            };

            /*
                Норма холодной воды в таблице не выписана: она равна разности
                общей и горячей. Хранить её отдельно значило бы завести второй
                источник правды, который однажды разойдётся с первым.
            */
            norm.quc = Math.max(0, norm.qu - norm.quh);
            norm.qhruc = Math.max(0, norm.qhru - norm.qhruh);

            /*
                Расход прибором холодной воды в таблице А.2 отдельной графой не
                выписан и берётся равным расходу горячей. Это не упрощение: в
                графах стоит один и тот же прибор — смеситель, и обе его
                половины одинаковы. Подставить сюда общий расход значит завысить
                вероятность действия приборов в полтора раза; на примере 5.1
                пособия это даёт 4,19 л/с вместо 3,68.

                Там, где горячей воды у потребителя нет, холодная ветвь
                совпадает с общей — тогда берётся общий расход.
            */
            norm.q0c = norm.q0h > 0 ? norm.q0h : norm.q0;
            norm.q0hrc = norm.q0hrh > 0 ? norm.q0hrh : norm.q0hr;

            norms.push(norm);
        }

        return norms;
    }

    /*
        Нормы проекта — дополнения и правки к таблице А.2.

        Норматив выходит с изменениями, а в перенесённой таблице лежит не весь
        перечень: строк там тридцать, а у объекта может оказаться прачечная,
        баня или лаборатория. Заставлять из-за этого править файл программы
        неправильно — своя строка должна заводиться там же, где идёт расчёт, и
        уезжать вместе с проектом.

        Правка с ТЕМ ЖЕ именем заменяет встроенную строку целиком; имя новое —
        строка добавляется в конец. Встроенные данные при этом не трогаются: в
        любой момент видно, где норматив, а где своё.
    */
    var custom = [];

    function setCustom(list) {
        custom = [];
        if (!list || !list.length) return;

        for (var i = 0; i < list.length; i++) {
            var one = list[i];
            if (!one || !one.name) continue;

            var made = {
                name: String(one.name),
                unit: String(one.unit === undefined ? '1 потребитель' : one.unit),
                qu: number(one.qu),
                quh: number(one.quh),
                qhru: number(one.qhru),
                qhruh: number(one.qhruh),
                q0: number(one.q0),
                q0hr: number(one.q0hr),
                q0h: number(one.q0h),
                q0hrh: number(one.q0hrh),
                t: number(one.t) > 0 ? number(one.t) : 24,
                custom: true
            };

            made.quc = Math.max(0, made.qu - made.quh);
            made.qhruc = Math.max(0, made.qhru - made.qhruh);
            made.q0c = made.q0h > 0 ? made.q0h : made.q0;
            made.q0hrc = made.q0hrh > 0 ? made.q0hrh : made.q0hr;

            custom.push(made);
        }
    }

    function number(value) {
        var parsed = parseFloat(String(value === undefined || value === null ? 0 : value)
            .replace(',', '.'));
        return isFinite(parsed) && parsed > 0 ? parsed : 0;
    }

    /* Встроенные нормы, поверх которых наложены проектные. */
    function allNorms() {
        var base = loadNorms();
        var out = [];
        var i, k;

        for (i = 0; i < base.length; i++) {
            var replaced = null;

            for (k = 0; k < custom.length; k++) {
                if (custom[k].name === base[i].name) replaced = custom[k];
            }

            out.push(replaced || base[i]);
        }

        for (k = 0; k < custom.length; k++) {
            var known = false;

            for (i = 0; i < base.length; i++) {
                if (base[i].name === custom[k].name) known = true;
            }

            if (!known) out.push(custom[k]);
        }

        return out;
    }

    function norm(name) {
        var list = allNorms();
        for (var i = 0; i < list.length; i++) {
            if (list[i].name === name) return list[i];
        }
        return null;
    }

    /* Норма встроена в норматив, а не заведена в проекте. */
    function isBuiltIn(name) {
        var base = loadNorms();
        for (var i = 0; i < base.length; i++) if (base[i].name === name) return true;
        return false;
    }

    /* --- Приложение К: пропускная способность стояков -------------------- */

    var stacks = null;

    function loadStacks() {
        if (stacks) return stacks;

        var raw = rows(SP30.raw['K']);
        stacks = [];

        for (var i = 0; i < raw.length; i++) {
            var line = raw[i];
            if (line.length < 7) continue;

            var row = {
                vented: line[0].toLowerCase().indexOf('невент') !== 0,
                material: line[1],
                riser: num(line, 2, 0),
                branch: num(line, 3, 0),
                angle: num(line, 4, 0),
                height: num(line, 5, 0),
                capacity: num(line, 6, 0)
            };

            if (row.riser > 0 && row.capacity > 0) stacks.push(row);
        }

        return stacks;
    }

    /*
        Пропускная способность стояка, л/с. Ноль — подходящей строки нет.

        Зависит от четырёх вещей сразу: материала, диаметра стояка, диаметра
        поэтажного отвода и УГЛА его присоединения. Угол — не мелочь: у стояка
        Ø110 из ПВХ при отводах под 45° это 8,22 л/с, а под 87,5° — 4,83.

        У невентилируемых добавляется пятая зависимость — высота: чем выше
        столб, тем сильнее разрежение. Между узлами по высоте интерполируем,
        по остальным осям — нет: там не непрерывные величины, а перечень
        исполнений.
    */
    function capacity(vented, material, riserMm, branchMm, angleDeg, heightM) {
        var list = loadStacks();
        var matched = [];

        for (var i = 0; i < list.length; i++) {
            var row = list[i];

            if (row.vented !== vented) continue;
            if (row.material !== material) continue;
            if (Math.abs(row.riser - riserMm) > 1) continue;
            if (Math.abs(row.branch - branchMm) > 1) continue;
            if (Math.abs(row.angle - angleDeg) > 0.6) continue;

            matched.push(row);
        }

        if (matched.length === 0) {
            return {
                value: 0,
                source: 'в приложении К нет строки: ' + material + ' Ø' + riserMm
                    + ', отвод Ø' + branchMm + ' под ' + Format.angle(angleDeg)
                    + (vented ? ', вентилируемый' : ', невентилируемый')
            };
        }

        var head = matched[0].material + ' Ø' + riserMm + ', отвод Ø' + branchMm
            + ' под ' + Format.angle(angleDeg);

        if (vented) {
            return { value: matched[0].capacity, source: 'приложение К, ' + head + ', вентилируемый' };
        }

        matched.sort(function (a, b) { return a.height - b.height; });

        var source = 'приложение К, ' + head + ', невентилируемый высотой '
            + heightM.toFixed(1) + ' м';

        if (heightM <= matched[0].height) {
            return { value: matched[0].capacity, source: source };
        }

        var last = matched[matched.length - 1];

        /*
            Выше последнего узла таблицы не экстраполируем: там невентилируемый
            стояк уже не применяется, и выдуманное число было бы опаснее
            отсутствия.
        */
        if (heightM >= last.height) {
            return { value: last.capacity, source: source + ' (сверх таблицы принято по последнему узлу)' };
        }

        for (var j = 1; j < matched.length; j++) {
            if (heightM > matched[j].height) continue;

            var below = matched[j - 1];
            var above = matched[j];
            var k = (heightM - below.height) / (above.height - below.height);

            return { value: below.capacity + k * (above.capacity - below.capacity), source: source };
        }

        return { value: last.capacity, source: source };
    }

    /* Наборы значений для выпадающих списков — строятся из самой таблицы К. */
    function stackOptions(vented, material) {
        var list = loadStacks();
        var risers = [];
        var branches = [];
        var angles = [];
        var heights = [];

        for (var i = 0; i < list.length; i++) {
            var row = list[i];
            if (row.vented !== vented) continue;
            if (material && row.material !== material) continue;

            if (risers.indexOf(row.riser) < 0) risers.push(row.riser);
            if (branches.indexOf(row.branch) < 0) branches.push(row.branch);
            if (angles.indexOf(row.angle) < 0) angles.push(row.angle);
            if (row.height > 0 && heights.indexOf(row.height) < 0) heights.push(row.height);
        }

        var byValue = function (a, b) { return a - b; };

        risers.sort(byValue);
        branches.sort(byValue);
        angles.sort(byValue);
        heights.sort(byValue);

        return { risers: risers, branches: branches, angles: angles, heights: heights };
    }

    function materials(vented) {
        var list = loadStacks();
        var names = [];

        for (var i = 0; i < list.length; i++) {
            if (list[i].vented !== vented) continue;
            if (names.indexOf(list[i].material) < 0) names.push(list[i].material);
        }

        return names;
    }

    return {
        rows: rows,
        alpha: alpha,
        fromB1: fromB1,
        fromB2: fromB2,
        tableOf: tableOf,
        fixtures: loadFixtures,
        fixture: fixture,
        norms: allNorms,
        builtInNorms: loadNorms,
        isBuiltIn: isBuiltIn,
        setCustom: setCustom,
        norm: norm,
        capacity: capacity,
        stackOptions: stackOptions,
        materials: materials
    };
})();
