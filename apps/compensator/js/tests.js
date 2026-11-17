'use strict';

/*
    Проверки расчёта. Открывается tests.html — результат виден сразу.

    Главные из них — сверка с опубликованными числами: коэффициент жёсткости
    отводов по таблице № 1 и напряжения по таблице № 2 статьи Горуновича
    (РосТепло.ру, 2009). Остальное — внутренние инварианты: обратимость
    компенсирующей способности, линейность по перемещению, кодировка DXF.
*/

(function () {

    var results = [];

    function ok(name, pass, got, want, note) {
        results.push({ name: name, pass: !!pass, got: got, want: want, note: note });
    }

    function near(name, got, want, tol, note) {
        var d = Math.abs(got - want);
        ok(name, d <= tol, U.fmt(got, 4), U.fmt(want, 4) + ' ± ' + U.fmt(tol, 4), note);
    }

    function rel(name, got, want, pct, note) {
        var d = want === 0 ? Math.abs(got) : Math.abs(got - want) / Math.abs(want) * 100;
        ok(name, d <= pct, U.fmt(got, 3) + ' (расх. ' + U.fmt(d, 2) + ' %)',
            U.fmt(want, 3) + ' ± ' + pct + ' %', note);
    }

    /* ============================================================ мелочи */

    near('U.num понимает запятую', U.num('1,25'), 1.25, 1e-12);
    near('U.num понимает точку', U.num('1.25'), 1.25, 1e-12);
    ok('U.num на пустой строке даёт NaN', isNaN(U.num('')), 'NaN', 'NaN');
    near('U.interp между узлами', U.interp([[0, 0], [10, 100]], 5), 50, 1e-9);
    near('U.interp за правым краем', U.interp([[0, 0], [10, 100]], 99), 100, 1e-9);

    /* ============================================================ сечение */

    (function () {
        var sec = Calc.section(0.108, 0.004);
        near('Внутренний диаметр 108×4', sec.dIn * 1000, 100, 1e-9);
        rel('Момент инерции 108×4', sec.J * 1e8, 176.96, 0.5, 'π(D⁴−d⁴)/64');
        rel('Момент сопротивления 108×4', sec.W * 1e6, 32.77, 0.5, 'W = 2J/Dн');
        rel('Масса 1 м 108×4', Calc.RHO_STEEL * sec.area, 10.26, 1, 'ГОСТ даёт 10,26 кг/м');
    })();

    (function () {
        var sec = Calc.section(0.159, 0.0045);
        rel('Масса 1 м 159×4,5', Calc.RHO_STEEL * sec.area, 17.15, 1, 'ГОСТ 10704-91');
    })();

    /* ============================================================ коэффициент Кармана */

    /*
        Таблица № 1 статьи Горуновича: отводы ОСТ 34-42-699-85, R = 1,5·Dу.
        Совпадение должно быть точным до третьего знака.
    */
    (function () {
        var cases = [
            ['89×3,5,  R = 120 мм', 89, 3.5, 0.120, 0.154],
            ['159×6,   R = 225 мм', 159, 6, 0.225, 0.154],
            ['325×10,  R = 450 мм', 325, 10, 0.450, 0.134],
            ['630×12,  R = 600 мм', 630, 12, 0.600, 0.106]
        ];
        cases.forEach(function (c) {
            var sec = Calc.section(c[1] / 1000, c[2] / 1000);
            var b = Calc.bend(sec, c[3]);
            near('Коэффициент Кармана k, ' + c[0], b.k, c[4], 0.0015, 'табл. № 1 Горуновича');
        });
    })();

    /* ============================================================ упругий центр */

    /*
        Ручной счёт для 108×4, H = 1,2, B = 1,1, R = 0,15, плечо от оси
        компенсатора b = 2,6 м (значит прямое плечо l = 2,6 − 0,55 − 0,15 = 1,9 м).
    */
    (function () {
        var sec = Calc.section(0.108, 0.004);
        var b = Calc.bend(sec, 0.15);
        var g = Calc.elasticCentre(1.2, 1.1, 0.15, 1.9, 1.9, b.k);
        near('Упругий центр ys (108×4)', g.ys, 0.4580, 0.002, 'ручной счёт');
        rel('Момент инерции упругой линии Jxs', g.Jxs, 3.4022, 0.5, 'ручной счёт');
        near('Приведённая длина оси Lпр', g.Lpr, 12.6744, 0.03, '2 × 6,3372');

        var Px = 0.05 * 2e11 * sec.J / g.Jxs;
        rel('Сила упругого отпора Px', Px, 5201, 1, 'Δ = 50 мм, E = 2·10⁵ МПа');
        rel('Напряжение без m₁', Px * g.arm / sec.W / 1e6, 117.8, 1, 'ручной счёт');
    })();

    /* ============================================================ контрольный пример */

    /*
        Таблица № 2 статьи Горуновича: четыре компенсатора, сталь 20,
        предварительная растяжка. Столбец «согласно [2]» — справочная методика.
    */
    (function () {
        var cases = [
            ['108×4', 108, 4, 1.2, 1.1, 2.6, 0.15, 0.05, 284],
            ['159×6', 159, 6, 1.8, 1.56, 3.52, 0.225, 0.06, 226],
            ['325×10', 325, 10, 3.6, 3.1, 6.8, 0.45, 0.13, 266],
            ['530×12', 530, 12, 6, 5, 11, 0.5, 0.175, 358.8]
        ];
        cases.forEach(function (c) {
            var sec = Calc.section(c[1] / 1000, c[2] / 1000);
            var bd = Calc.bend(sec, c[6]);
            var arm = c[5] - (c[4] / 2 + c[6]);
            var g = Calc.elasticCentre(c[3], c[4], c[6], arm, arm, bd.k);
            var Px = c[7] * 2e11 * sec.J / g.Jxs;
            var sig = Px * g.arm / sec.W / 1e6 * bd.m1;
            rel('Напряжение по табл. № 2, ' + c[0], sig, c[8], 4,
                'расхождение объясняется округлением m₁ в статье');
        });
    })();

    /* ============================================================ удлинение */

    (function () {
        var e = Calc.elongation('carbon', 30, 10, 130);
        near('α при 130 °C', e.alpha * 1e6, 12.08, 0.02, 'РД 10-249-98: 11,9 при 100 и 12,2 при 150');
        near('Δt', e.dt, 120, 1e-9);
        rel('Δl = α·L·Δt', e.dl * 1000, 43.49, 0.5, '12,08·10⁻⁶ · 30 · 120');
    })();

    /* ============================================================ полный расчёт */

    function baseInput(over) {
        var inp = {
            sort: 'esw', dn: 100, dOut: 108, s: 4, steel: 'st20',
            pressure: 0.6, tInstall: 10, tWork: 95,
            L: 27, L1: 13.5, L2: 13.5, stretch: 0.5, plane: 'v',
            R: 0.15, H: 1.5, B: 1.275,
            sigmaMode: 'ref', sigmaManual: '', useM1: true, EManual: 0,
            support: 'slide', muManual: 0, span: '',
            insThk: 0, insRho: 0, gammaF: 1, floors: 9, floorH: 3
        };
        if (over) Object.keys(over).forEach(function (k) { inp[k] = over[k]; });
        return inp;
    }

    (function () {
        var res = Calc.run(baseInput());
        ok('Расчёт отработал', isFinite(res.Px) && isFinite(res.sigma), 'да', 'да');
        near('Расчётное перемещение — половина удлинения', res.delta, res.dl / 2, 1e-12,
            'растяжка 50 %');
        rel('[σ] по справочнику для стали 20', res.sigmaAdm, 120, 0.01,
            'Громов/Шубин: 120 МПа для сталей 10, 20, Ст2сп');

        // компенсирующая способность обратима: при Δ = Δдоп напряжение равно [σ]
        var res2 = Calc.run(baseInput({ L: res.Lmax }));
        rel('При L = Lmax напряжение равно допускаемому', res2.sigmaCheck, res2.sigmaAdm, 0.5);

        // линейность по перемещению
        var a = Calc.run(baseInput({ L: 10 }));
        var b2 = Calc.run(baseInput({ L: 20 }));
        rel('Напряжение линейно по длине участка', b2.sigmaCheck, a.sigmaCheck * 2, 0.01);

        // растяжка вдвое уменьшает расчётное перемещение
        var noStretch = Calc.run(baseInput({ stretch: 0 }));
        rel('Без растяжки перемещение вдвое больше', noStretch.delta, res.delta * 2, 0.01);
    })();

    /* ============================================================ нагрузки */

    (function () {
        var res = Calc.run(baseInput({ support: 'slide', insThk: 0 }));
        near('μx скользящей опоры', res.muX, 0.30, 1e-9, 'табл. 1* прил. 8 СНиП 2.04.07-86*');
        rel('Трение на плече Fтр = μ·Gh·L1', res.Ffr1, 0.3 * res.Gh * 13.5, 0.01);
        rel('Концевая опора N = Px + Fтр', res.Nend, res.Px + res.Ffr1, 0.01);
        rel('Симметричный участок: N промежуточной = 0,3·ΣF', res.Nmid, 0.3 * (res.Px + res.Ffr1), 0.01,
            'примечание 2 к п. 5');

        var asym = Calc.run(baseInput({ L1: 20, L2: 7 }));
        var s1 = asym.Px + asym.Ffr1, s2 = asym.Px + asym.Ffr2;
        rel('Несимметричный участок: N = ΣFб − 0,7·ΣFм', asym.Nmid,
            Math.max(s1, s2) - 0.7 * Math.min(s1, s2), 0.01);

        var roller = Calc.run(baseInput({ support: 'roller' }));
        near('μx катковой опоры', roller.muX, 0.10, 1e-9);
        near('μy катковой опоры', roller.muY, 0.30, 1e-9, 'по оси 0,1, под углом 0,3');

        var ins = Calc.run(baseInput({ insThk: 50, insRho: 80 }));
        ok('Изоляция утяжеляет погонный вес', ins.Gh > res.Gh,
            U.fmt(ins.Gh, 1), '> ' + U.fmt(res.Gh, 1));

        // на вертикальном стояке осевая реакция идёт на перекрытие
        var vert = Calc.run(baseInput({ plane: 'v' }));
        rel('Нагрузка на перекрытие (стояк)', vert.slabLoad, vert.NendCalc + vert.slabPipeWeight, 0.01);
        var horiz = Calc.run(baseInput({ plane: 'h' }));
        rel('Нагрузка на перекрытие (горизонт)', horiz.slabLoad, horiz.FvCalc, 0.01);
    })();

    /* ============================================================ подбор и расстановка */

    (function () {
        var inp = baseInput({ L: 40 });
        var found = Calc.pickH(inp, 'ratio', 0.85);
        ok('Вылет подобрался', !!found, found ? U.fmt(found.H * 1000, 0) + ' мм' : 'нет', 'да');
        if (found) {
            rel('При подобранном H напряжение равно допускаемому',
                found.result.sigmaCheck, found.result.sigmaAdm, 1);
            near('Спинка связана с вылетом', found.B / found.H, 0.85, 1e-6);
        }

        var res = Calc.run(baseInput({ floors: 12, floorH: 3 }));
        if (res.floorsPerZone > 0) {
            ok('Участок укладывается в предельную длину',
                res.floorsPerZone * res.floorH <= res.Lmax + 1e-9,
                U.fmt(res.floorsPerZone * res.floorH, 2), '≤ ' + U.fmt(res.Lmax, 2));
            ok('Участков хватает на все этажи', res.zones * res.floorsPerZone >= res.floors,
                String(res.zones * res.floorsPerZone), '≥ ' + res.floors);
        }
        var high = Calc.run(baseInput({ floorH: 3.6 }));
        near('Высокий этаж — крепления через половину высоты', high.riserStep, 1.8, 1e-9,
            'СП 73.13330.2016 п. 6.1.9');
        var low = Calc.run(baseInput({ floorH: 2.8 }));
        near('Низкий этаж — одно крепление на этаж', low.riserStep, 2.8, 1e-9);
    })();

    /* ============================================================ предупреждения */

    (function () {
        var small = Calc.run(baseInput({ R: 0.05 }));
        ok('Малый радиус гиба вызывает предупреждение', small.warn.length > 0,
            String(small.warn.length), '> 0', 'СП 124.13330.2012 п. 10.31');
        var cold = Calc.run(baseInput({ tWork: 5 }));
        ok('Отсутствие нагрева вызывает предупреждение', cold.warn.length > 0,
            String(cold.warn.length), '> 0');
    })();

    /* ============================================================ вывод */

    (function () {
        var inp = baseInput();
        var res = Calc.run(inp);
        var text = Report.build(inp, res);
        ok('Отчёт собирается', text.length > 2000, text.length + ' знаков', '> 2000');
        ok('В отчёте есть источники', text.indexOf('ИСТОЧНИКИ') > 0, 'да', 'да');
        ok('В отчёте есть СНиП 2.04.07-86*', text.indexOf('2.04.07-86') > 0, 'да', 'да');

        var svg = Scheme.node(res, { mode: 'light', width: 800 });
        ok('Схема узла рисуется', svg.indexOf('<svg') === 0 && svg.length > 1500,
            svg.length + ' знаков', '> 1500');
        ok('На схеме есть размер вылета', svg.indexOf('H = ') > 0, 'да', 'да');

        var riser = Scheme.riser(res, { mode: 'light' });
        ok('Схема стояка рисуется', riser.indexOf('<svg') === 0, 'да', 'да');
    })();

    /* ============================================================ DXF */

    (function () {
        var a = Dxf.cp1251('А');
        var ya = Dxf.cp1251('я');
        var yo = Dxf.cp1251('Ё');
        near('CP1251: «А» = 0xC0', a[0], 0xC0, 0);
        near('CP1251: «я» = 0xFF', ya[0], 0xFF, 0);
        near('CP1251: «Ё» = 0xA8', yo[0], 0xA8, 0);
        var deg = Dxf.cp1251('°');
        near('CP1251: градус = 0xB0', deg[0], 0xB0, 0);
        var greek = Dxf.cp1251('Δ');
        near('Δ заменяется латинской D', greek[0], 'D'.charCodeAt(0), 0);
        ok('В байтах нет нулей', Dxf.cp1251('Компенсатор 108×4').indexOf(0) < 0, 'нет', 'нет');

        var res = Calc.run(baseInput());
        var bytes = Dxf.nodeDxf(res);
        var headText = '';
        for (var i = 0; i < 40 && i < bytes.length; i++) headText += String.fromCharCode(bytes[i]);
        ok('DXF начинается с секции', headText.indexOf('SECTION') > 0, headText.slice(0, 20).replace(/\r|\n/g, '·'), 'SECTION');
        ok('DXF достаточно большой', bytes.length > 3000, bytes.length + ' байт', '> 3000');

        var all = '';
        for (var j = 0; j < bytes.length; j++) all += String.fromCharCode(bytes[j]);
        ok('В DXF есть кодовая страница', all.indexOf('ANSI_1251') > 0, 'да', 'да');
        ok('В DXF есть дуги отводов', all.indexOf('ARC') > 0, 'да', 'да');
        ok('В DXF есть слой размеров', all.indexOf(String.fromCharCode(0xD0, 0xC0, 0xC7, 0xCC, 0xC5, 0xD0, 0xDB)) > 0,
            'да', 'да', 'РАЗМЕРЫ в CP1251');

        var riser = Dxf.riserDxf(res);
        ok('DXF стояка собирается', riser.length > 2000, riser.length + ' байт', '> 2000');
    })();

    /* ============================================================ вывод на страницу */

    var passed = results.filter(function (r) { return r.pass; }).length;
    var total = results.length;
    var sum = document.getElementById('sum');
    sum.textContent = passed + ' из ' + total + ' проверок пройдено';
    sum.className = (passed === total) ? 'pass' : 'fail';

    var out = document.getElementById('out');
    out.innerHTML = results.map(function (r) {
        return '<li class="' + (r.pass ? 'pass' : 'fail') + '">' +
            (r.pass ? '✔ ' : '✘ ') + U.esc(r.name) +
            ': <b>' + U.esc(r.got) + '</b> (ожидалось ' + U.esc(r.want) + ')' +
            (r.note ? ' <span class="note">— ' + U.esc(r.note) + '</span>' : '') +
            '</li>';
    }).join('');
})();
