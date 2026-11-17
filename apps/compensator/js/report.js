'use strict';

/*
    Текстовый отчёт: то, что можно приложить к проекту и проверить руками.
    Каждая формула печатается в том виде, в каком она подставлена, и рядом
    указывается источник — чтобы не пришлось верить программе на слово.
*/

var Report = (function () {

    function head(title) {
        return ['', title, new Array(Math.min(title.length, 78) + 1).join('─')];
    }

    function row(name, value, unit, note) {
        var s = U.pad(name, 46) + U.padl(value, 14) + (unit ? ' ' + unit : '');
        if (note) s += '   ' + note;
        return s;
    }

    /** Полный отчёт по расчёту. inp — исходные данные, res — Calc.run(inp). */
    function build(inp, res) {
        var L = [];
        var sec = res.sec;
        var g = res.geom;

        L.push('РАСЧЁТ СТАЛЬНОГО П-ОБРАЗНОГО КОМПЕНСАТОРА');
        L.push(U.today() + (inp.object ? '   ·   ' + inp.object : '') + (inp.system ? '   ·   ' + inp.system : ''));
        L.push('Метод упругого центра тяжести (Громов/Шубин 1988; Соколов 1982; Николаев 1965),');
        L.push('тот же, что положен в основу приложения 3 РД 10-400-01.');

        /* ---------------------------------------------------- исходные */
        L = L.concat(head('1. ИСХОДНЫЕ ДАННЫЕ'));
        L.push(row('Труба, наружный диаметр × толщина стенки',
            U.fmt(sec.dOut * 1000, 1) + '×' + U.fmt(sec.s * 1000, 1), 'мм',
            TABLES.SORTS[inp.sort] ? TABLES.SORTS[inp.sort].name : ''));
        L.push(row('Условный проход Dу', String(inp.dn), 'мм'));
        L.push(row('Внутренний диаметр', U.fmt(sec.dIn * 1000, 1), 'мм'));
        L.push(row('Марка стали', res.steel.name, ''));
        L.push(row('Температура монтажа (замыкания)', U.fmt(inp.tInstall, 1), '°C'));
        L.push(row('Рабочая температура', U.fmt(inp.tWork, 1), '°C'));
        L.push(row('Длина компенсируемого участка L', U.fmt(inp.L, 2), 'м', 'между неподвижными опорами'));
        L.push(row('Плечо до первой опоры L1', U.fmt(inp.L1, 2), 'м'));
        L.push(row('Плечо до второй опоры L2', U.fmt(inp.L2, 2), 'м'));
        L.push(row('Предварительная растяжка', U.fmt(res.stretch * 100, 0), '%', 'e по РД 10-400-01, прил. 3, п. 3.3'));
        L.push(row('Вылет компенсатора H', U.fmt(res.H * 1000, 0), 'мм'));
        L.push(row('Спинка (створ) B', U.fmt(res.B * 1000, 0), 'мм'));
        L.push(row('Радиус гиба отводов R', U.fmt(res.R * 1000, 0), 'мм',
            U.fmt(res.R / sec.dOut, 2) + '·Dн'));
        L.push(row('Плоскость компенсатора', res.plane === 'v' ? 'вертикальная (стояк)' : 'горизонтальная', ''));
        L.push(row('Рабочее давление', U.fmt(res.pressMPa, 2), 'МПа'));

        /* ---------------------------------------------------- удлинение */
        L = L.concat(head('2. ТЕМПЕРАТУРНОЕ УДЛИНЕНИЕ'));
        L.push('α — средний коэффициент линейного расширения в интервале 20…t');
        L.push('    (РД 10-249-98, справочное приложение; углеродистые и низколегированные стали)');
        L.push(row('α при ' + U.fmt(inp.tWork, 0) + ' °C', U.fmt(res.alpha * 1e6, 2) + '·10⁻⁶', '1/K'));
        L.push(row('Перепад температур Δt = tраб − tмонт', U.fmt(res.dt, 1), '°C'));
        L.push('');
        L.push('    Δl = α · L · Δt = ' + U.fmt(res.alpha * 1e6, 2) + '·10⁻⁶ · ' + U.fmt(inp.L, 2) +
            ' · ' + U.fmt(res.dt, 1) + ' = ' + U.fmt(res.dl * 1000, 2) + ' мм');
        L.push('');
        L.push(row('Холодная растяжка при монтаже', U.fmt(res.dlStretch * 1000, 2), 'мм',
            U.fmt(res.stretch * 100, 0) + ' % от Δl'));
        L.push(row('Расчётное перемещение Δ = Δl·(1 − e)', U.fmt(res.delta * 1000, 2), 'мм'));
        L.push(row('    в том числе на каждую сторону', U.fmt(res.delta * 500, 2), 'мм'));

        /* ---------------------------------------------------- отводы */
        L = L.concat(head('3. ОТВОДЫ: ХАРАКТЕРИСТИКА ГИБА И ЖЁСТКОСТЬ'));
        L.push('Гнутый отвод податливее прямой трубы: сечение при изгибе сплющивается');
        L.push('(эффект Кармана). Длина дуги приводится делением на коэффициент жёсткости k.');
        L.push(row('Средний радиус сечения rср = (Dн − s)/2', U.fmt(sec.rMid * 1000, 2), 'мм'));
        L.push('');
        L.push('    h = s·R / r²ср = ' + U.fmt(sec.s * 1000, 1) + ' · ' + U.fmt(res.R * 1000, 0) +
            ' / ' + U.fmt(sec.rMid * 1000, 2) + '² = ' + U.fmt(res.h, 4));
        L.push('    k = (1 + 12h²) / (10 + 12h²) = ' + U.fmt(res.k, 4));
        L.push('    m₁ = 0,9 / h^(2/3) = ' + U.fmt(res.m1, 3) + '   (коэффициент интенсификации напряжений)');
        L.push('');
        L.push(row('Фактическая длина отвода 90°  πR/2', U.fmt(g.arc * 1000, 1), 'мм'));
        L.push(row('Приведённая длина отвода  πR/(2k)', U.fmt(g.arcPr * 1000, 1), 'мм'));

        /* ---------------------------------------------------- упругий центр */
        L = L.concat(head('4. УПРУГИЙ ЦЕНТР ОСИ КОМПЕНСАТОРА'));
        L.push('Оси переносятся в упругий центр тяжести; после переноса Sx = 0 и Jxy = 0,');
        L.push('и сила упругого отпора выражается одной формулой.');
        L.push(row('Приведённая длина оси Lпр', U.fmt(g.Lpr, 3), 'м'));
        L.push(row('Координата упругого центра ys', U.fmt(g.ys * 1000, 1), 'мм'));
        L.push(row('Плечо максимального момента H − ys', U.fmt(g.arm * 1000, 1), 'мм'));
        L.push(row('Момент инерции упругой линии Jxs', U.fmt(g.Jxs, 4), 'м³'));
        L.push(row('Развёрнутая длина трубы компенсатора', U.fmt(g.devLen, 3), 'м',
            'спинка + 2 вылета + 4 отвода'));

        /* ---------------------------------------------------- усилия */
        L = L.concat(head('5. УСИЛИЯ И НАПРЯЖЕНИЯ'));
        L.push(row('Модуль упругости E при ' + U.fmt(inp.tWork, 0) + ' °C', U.fmt(res.EMPa / 1000, 1) + '·10³', 'МПа',
            'РД 10-249-98'));
        L.push(row('Момент инерции сечения J', U.fmt(sec.J * 1e8, 2) + '·10⁻⁸', 'м⁴'));
        L.push(row('Момент сопротивления W', U.fmt(sec.W * 1e6, 2) + '·10⁻⁶', 'м³'));
        L.push('');
        L.push('    Px = Δ · E · J / Jxs = ' + U.fmt(res.delta, 5) + ' · ' + U.fmt(res.EMPa, 0) +
            '·10⁶ · ' + U.fmt(sec.J * 1e8, 2) + '·10⁻⁸ / ' + U.fmt(g.Jxs, 4));
        L.push('       = ' + U.fmt(res.Px, 0) + ' Н = ' + U.fmt(res.Px / 1000, 2) + ' кН');
        L.push('');
        L.push('    Mmax = Px · (H − ys) = ' + U.fmt(res.Px / 1000, 2) + ' · ' + U.fmt(g.arm, 3) +
            ' = ' + U.fmt(res.Mmax / 1000, 2) + ' кН·м        (момент в спинке)');
        L.push('');
        L.push('    σ = Mmax / W = ' + U.fmt(res.sigma, 1) + ' МПа');
        L.push('    σ · m₁ = ' + U.fmt(res.sigmaM1, 1) + ' МПа   (с коэффициентом интенсификации)');
        L.push('');
        L.push(row('Принято к проверке', U.fmt(res.sigmaCheck, 1), 'МПа',
            res.useM1 ? 'с m₁' : 'без m₁'));
        L.push(row('Допускаемое напряжение [σ]', U.fmt(res.sigmaAdm, 1), 'МПа', res.sigmaAdmWhy));
        L.push(row('Использование', U.fmt(res.util * 100, 0), '%'));
        L.push('');
        L.push(res.ok
            ? '    ВЫВОД: σ = ' + U.fmt(res.sigmaCheck, 1) + ' ≤ [σ] = ' + U.fmt(res.sigmaAdm, 1) + ' МПа — компенсатор проходит.'
            : '    ВЫВОД: σ = ' + U.fmt(res.sigmaCheck, 1) + ' > [σ] = ' + U.fmt(res.sigmaAdm, 1) + ' МПа — НЕ ПРОХОДИТ.');
        L.push('');
        L.push(row('Кольцевое напряжение от давления (справочно)', U.fmt(res.sigmaHoop, 1), 'МПа',
            'σкц = P·Dвн/(2s)'));
        L.push('    П-образный компенсатор не создаёт распорного усилия от внутреннего давления:');
        L.push('    в приложении 8 СНиП 2.04.07-86* неуравновешенные силы давления отнесены');
        L.push('    только к сальниковым (п. 4.3) и сильфонным (п. 4.4) компенсаторам.');

        /* ---------------------------------------------------- способность */
        L = L.concat(head('6. КОМПЕНСИРУЮЩАЯ СПОСОБНОСТЬ'));
        L.push('    Δдоп = 2 · [σ] · Jxs / (m · E · Dн · (H − ys))');
        L.push(row('Компенсирующая способность Δдоп', U.fmt(res.deltaAdm * 1000, 1), 'мм',
            'при [σ] = ' + U.fmt(res.sigmaAdm, 0) + ' МПа'));
        L.push(row('То же в пересчёте на полное удлинение', U.fmt(res.dlAdm * 1000, 1), 'мм',
            'с учётом растяжки ' + U.fmt(res.stretch * 100, 0) + ' %'));
        L.push(row('Предельная длина компенсируемого участка', U.fmt(res.Lmax, 2), 'м',
            'при Δt = ' + U.fmt(res.dt, 0) + ' °C'));
        L.push(row('Табличный ориентир между неподвижными опорами', U.fmt(TABLES.lFixFor(inp.dn), 0), 'м',
            'ИжГТУ, табл. 8.1'));

        /* ---------------------------------------------------- нагрузки */
        L = L.concat(head('7. НАГРУЗКИ НА ОПОРЫ (СНиП 2.04.07-86*, приложение 8)'));
        L.push(row('Масса 1 м трубы', U.fmt(res.mPipe, 2), 'кг/м', 'ρ стали 7850 кг/м³'));
        L.push(row('Масса воды в 1 м', U.fmt(res.mWater, 2), 'кг/м'));
        L.push(row('Масса изоляции в 1 м', U.fmt(res.mIns, 2), 'кг/м'));
        L.push(row('Итого масса 1 м в рабочем состоянии', U.fmt(res.mTotal, 2), 'кг/м'));
        L.push(row('Вес 1 м Gh = Gv', U.fmt(res.Gh, 1), 'Н/м'));
        L.push('');
        L.push(row('Тип подвижных опор', res.friction.name, ''));
        L.push(row('Коэффициент трения μx / μy',
            U.fmt(res.muX, 2) + ' / ' + U.fmt(res.muY, 2), '', 'табл. 1* прил. 8'));
        L.push(row('Пролёт между подвижными опорами', U.fmt(res.span, 2), 'м'));
        L.push('');
        L.push('    Fv  = Gv · l = ' + U.fmt(res.Fv / 1000, 2) + ' кН      (вертикальная на подвижную опору, ф. 1)');
        L.push('    Fhy = μy · Gh · l = ' + U.fmt(res.Fhy / 1000, 2) + ' кН  (боковая на подвижную опору, ф. 3)');
        L.push('    Fтр1 = μx · Gh · L1 = ' + U.fmt(res.Ffr1 / 1000, 2) + ' кН   (трение на плече L1, ф. 5)');
        L.push('    Fтр2 = μx · Gh · L2 = ' + U.fmt(res.Ffr2 / 1000, 2) + ' кН   (трение на плече L2, ф. 5)');
        L.push('');
        L.push('    Концевая неподвижная опора (п. 5 — сумма сил с одной стороны):');
        L.push('        N = Px + Fтр = ' + U.fmt(res.Px / 1000, 2) + ' + ' +
            U.fmt(Math.max(res.Ffr1, res.Ffr2) / 1000, 2) + ' = ' + U.fmt(res.Nend / 1000, 2) + ' кН');
        L.push('    Промежуточная неподвижная опора (' + res.NmidRule + '):');
        L.push('        N = ' + U.fmt(res.Nmid / 1000, 2) + ' кН');
        L.push('');
        L.push(row('Коэффициент надёжности по нагрузке γf', U.fmt(res.gammaF, 2), '',
            res.gammaF === 1 ? 'нагрузки нормативные' : 'нагрузки расчётные'));
        L.push(row('Расчётная нагрузка на концевую Н.О.', U.fmt(res.NendCalc / 1000, 2), 'кН'));
        L.push(row('Расчётная нагрузка на промежуточную Н.О.', U.fmt(res.NmidCalc / 1000, 2), 'кН'));
        L.push(row('Расчётная вертикальная на подвижную опору', U.fmt(res.FvCalc / 1000, 2), 'кН'));
        L.push('');
        L.push('    Боковые нагрузки по п. 3 приложения 8 учитываются для опор под гибким');
        L.push('    компенсатором и на расстоянии до 40·Dу = ' + U.fmt(res.sideZone, 1) + ' м от него.');

        L = L.concat(head('8. НАГРУЗКА НА ПЕРЕКРЫТИЕ'));
        L.push('    ' + res.slabWhy);
        L.push(row('Вес трубы с водой на этаж', U.fmt(res.slabPipeWeight / 1000, 2), 'кН',
            'Gh · hэт'));
        L.push(row('Нагрузка на перекрытие в узле опоры', U.fmt(res.slabLoad / 1000, 2), 'кН',
            '≈ ' + U.fmt(res.slabLoadKgf, 0) + ' кгс'));

        /* ---------------------------------------------------- расстановка */
        L = L.concat(head('9. РАССТАНОВКА ПО ЭТАЖАМ'));
        L.push(row('Высота этажа', U.fmt(res.floorH, 2), 'м'));
        L.push(row('Число этажей', String(res.floors), ''));
        L.push(row('Высота стояка', U.fmt(res.riserH, 2), 'м'));
        if (res.floorsPerZone > 0) {
            L.push(row('Этажей на один компенсирующий участок', String(res.floorsPerZone), '',
                'по предельной длине ' + U.fmt(res.Lmax, 2) + ' м'));
            L.push(row('Число компенсирующих участков', String(res.zones), ''));
            L.push(row('Неподвижных опор', String(res.fixCount), '', 'включая обе крайние'));
            L.push(row('Компенсаторов', String(res.zones), '', 'по одному на участок'));
        } else {
            L.push('    Принятый компенсатор не воспринимает удлинение даже одного этажа —');
            L.push('    увеличьте вылет H, спинку B или разбейте стояк чаще.');
        }
        L.push(row('Шаг креплений стояка', U.fmt(res.riserStep, 2), 'м', res.riserStepWhy));
        L.push('    (СП 73.13330.2016 п. 6.1.9; в производственных зданиях — не более 3 м)');

        /* ---------------------------------------------------- замечания */
        if (res.warn.length || res.notes.length) {
            L = L.concat(head('10. ЗАМЕЧАНИЯ'));
            res.warn.forEach(function (w) { L.push('  ! ' + w); });
            res.notes.forEach(function (w) { L.push('  · ' + w); });
        }

        /* ---------------------------------------------------- источники */
        L = L.concat(head('ИСТОЧНИКИ'));
        sourceList().forEach(function (s, i) {
            L.push('  ' + (i + 1) + '. ' + s.code + '. ' + s.title);
            L.push('     ' + s.pub);
            if (s.url) L.push('     ' + s.url);
        });

        return L.join('\n');
    }

    /** Все источники в порядке, в каком их удобно читать. */
    function sourceList() {
        var order = ['sp124', 'snip0407', 'rd400', 'gost55596', 'rd249', 'gromov', 'sokolov',
            'nikolaev', 'gorunovich', 'magalif', 'sp73', 'izhgtu', 'gost10704', 'gost8732',
            'gost3262', 'gost17375', 'startprof'];
        return order.map(function (k) { return SRC[k]; }).filter(Boolean);
    }

    return { build: build, sourceList: sourceList };
})();
