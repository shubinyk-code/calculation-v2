'use strict';

/*
    Расчёт стального П-образного компенсатора.

    Метод — тот же, что в справочной литературе по тепловым сетям (Громов/Шубин
    1988, Соколов 1982, Николаев 1965) и, как частный случай, в РД 10-400-01:
    теорема Кастилиано, оси переносятся в упругий центр тяжести оси компенсатора,
    после чего Sx = 0, Jxy = 0 и сила упругого отпора получается в один ход:

        Px = Δ · E · J / Jxs,

    где Jxs — момент инерции упругой линии оси компенсатора относительно
    горизонтальной оси, проходящей через упругий центр (размерность м³),
    J — осевой момент инерции сечения трубы (м⁴), Δ — воспринимаемое
    перемещение концов участка.

    Отличие от справочника: интегралы ∫y·ds и ∫y²·ds здесь берутся аналитически
    по участкам оси (спинка, два верхних отвода, два вылета, два нижних отвода,
    два плеча), а не «по миллиметровке», как предлагал Соколов. Длина дуговых
    элементов приводится делением на коэффициент жёсткости (Кармана) k ≤ 1 —
    именно из-за сплющивания сечения отвод гибче прямой трубы.

    Проверка: расчёт воспроизводит таблицу № 2 статьи Горуновича (РосТепло.ру,
    2009) для четырёх компенсаторов 108×4 … 530×12 с расхождением 2–3 %.
    Сами сверки — в js/tests.js.
*/

var Calc = (function () {

    var G = 9.80665;         // ускорение свободного падения, м/с²
    var RHO_STEEL = 7850;    // плотность стали, кг/м³
    var RHO_WATER = 1000;    // плотность воды, кг/м³ (в запас, как в СНиП для веса воды)

    var QUARTER = Math.PI / 2;        // ∫dθ на 0…π/2
    var INT_COS = 1;                  // ∫cosθ dθ на 0…π/2
    var INT_COS2 = Math.PI / 4;       // ∫cos²θ dθ на 0…π/2
    var INT_SIN = 1;                  // ∫sinθ dθ на 0…π/2

    /* ------------------------------------------------------------ сечение трубы */

    /**
     * Геометрия сечения по наружному диаметру и толщине стенки (обе в метрах).
     * J — осевой момент инерции, W — момент сопротивления, A — площадь металла.
     */
    function section(dOut, s) {
        var dIn = dOut - 2 * s;
        var J = Math.PI * (Math.pow(dOut, 4) - Math.pow(dIn, 4)) / 64;
        return {
            dOut: dOut, dIn: dIn, s: s,
            J: J,
            W: 2 * J / dOut,
            area: Math.PI / 4 * (dOut * dOut - dIn * dIn),
            rMid: (dOut - s) / 2
        };
    }

    /**
     * Характеристика гиба h = s·R / r²ср и коэффициент жёсткости (Кармана).
     *
     * k = (1 + 12h²) / (10 + 12h²) ≤ 1 — приведённая длина дугового элемента
     * равна его фактической длине, делённой на k. Формула проверена по четырём
     * отводам из таблицы № 1 статьи Горуновича (89×3,5 → 0,154; 159×6 → 0,154;
     * 325×10 → 0,134; 630×12 → 0,106) — совпадение точное.
     *
     * m1 = 0,9 / h^(2/3), но не менее 1 — коррекционный коэффициент, учитывающий
     * рост напряжений на гнутых участках (коэффициент интенсификации).
     */
    function bend(sec, R) {
        var h = sec.s * R / (sec.rMid * sec.rMid);
        var h2 = 12 * h * h;
        var k = (1 + h2) / (10 + h2);
        var m1 = 0.9 / Math.pow(h, 2 / 3);
        if (!(m1 > 1)) m1 = 1;
        return { h: h, k: k, m1: m1 };
    }

    /* ------------------------------------------------------------ упругий центр */

    /**
     * Интегралы по оси компенсатора и характеристики упругого центра.
     *
     * Ось лежит в плоскости xy: x — вдоль трубопровода, y — вдоль вылета.
     * Прямые плечи лежат на y = 0, спинка — на y = H, отводы радиусом R.
     *
     * H  — вылет (от оси трубопровода до оси спинки), м;
     * B  — спинка/створ (между осями вылетов), м;
     * R  — радиус гиба отводов, м;
     * l1, l2 — прямые плечи от отводов до опор, ограничивающих поперечное
     *          перемещение, м;
     * k  — коэффициент жёсткости отвода.
     */
    function elasticCentre(H, B, R, l1, l2, k) {
        var w = 1 / k;
        var Hr = H - R;
        var back = B - 2 * R;       // прямая часть спинки
        var leg = H - 2 * R;        // прямая часть вылета
        var arc = QUARTER * R;      // фактическая длина отвода 90°
        var arcPr = arc * w;        // приведённая длина отвода

        var I1 = 0;   // ∫ y ds
        var I2 = 0;   // ∫ y² ds
        var Lpr = 0;  // приведённая длина оси

        // спинка (одна, длиной B − 2R, вся на уровне y = H)
        I1 += H * back;
        I2 += H * H * back;
        Lpr += back;

        // два верхних отвода: y = (H − R) + R·cosθ, θ = 0…π/2
        I1 += 2 * (R * w) * (Hr * QUARTER + R * INT_COS);
        I2 += 2 * (R * w) * (Hr * Hr * QUARTER + 2 * Hr * R * INT_COS + R * R * INT_COS2);
        Lpr += 2 * arcPr;

        // два прямых вылета: y от R до H − R
        I1 += 2 * ((Hr * Hr - R * R) / 2);
        I2 += 2 * ((Hr * Hr * Hr - R * R * R) / 3);
        Lpr += 2 * leg;

        // два нижних отвода: y = R·(1 − sinθ)
        I1 += 2 * (R * R * w) * (QUARTER - INT_SIN);
        I2 += 2 * (R * R * R * w) * (QUARTER - 2 * INT_SIN + INT_COS2);
        Lpr += 2 * arcPr;

        // плечи лежат на y = 0: в I1 и I2 не входят, в приведённую длину — входят
        Lpr += l1 + l2;

        var ys = I1 / Lpr;
        var Jxs = I2 - Lpr * ys * ys;

        return {
            Lpr: Lpr,
            ys: ys,
            Jxs: Jxs,
            arm: H - ys,                              // плечо максимального момента
            devLen: back + 2 * leg + 4 * arc,         // развёрнутая длина трубы компенсатора
            back: back, leg: leg, arc: arc, arcPr: arcPr
        };
    }

    /* ------------------------------------------------------------ температура */

    /**
     * Температурное удлинение участка.
     * Δl = α · L · (tраб − tмонт); α — средний коэффициент линейного расширения
     * в интервале 20…tраб по РД 10-249-98.
     */
    function elongation(group, L, tInstall, tWork) {
        var alpha = TABLES.alpha(group, tWork);
        var dt = tWork - tInstall;
        return { alpha: alpha, dt: dt, dl: alpha * L * dt };
    }

    /* ------------------------------------------------------------ основной расчёт */

    /**
     * Полный расчёт компенсатора по заданным исходным данным.
     * Все длины во входном объекте — в метрах, диаметры и толщины — в мм.
     */
    function run(inp) {
        var out = { warn: [], notes: [] };

        var dOut = inp.dOut / 1000;
        var s = inp.s / 1000;
        var sec = section(dOut, s);
        out.sec = sec;

        var steel = TABLES.STEELS[inp.steel] || TABLES.STEELS.st20;
        out.steel = steel;

        // --- температура и удлинение
        var el = elongation(steel.group, inp.L, inp.tInstall, inp.tWork);
        out.alpha = el.alpha;
        out.dt = el.dt;
        out.dl = el.dl;                              // полное удлинение участка, м
        out.stretch = U.clamp(inp.stretch, 0, 1);
        out.dlStretch = out.dl * out.stretch;        // холодная растяжка при монтаже, м
        out.delta = out.dl * (1 - out.stretch);      // расчётное перемещение, м

        // --- модуль упругости
        out.E = (inp.EManual > 0) ? inp.EManual * 1e6 : TABLES.emod(steel.group, inp.tWork) * 1e6; // Па
        out.EMPa = out.E / 1e6;

        // --- геометрия
        var R = inp.R;
        var H = inp.H;
        var B = inp.B;
        if (!(R > 0)) { out.warn.push('Радиус гиба должен быть больше нуля.'); R = dOut; }
        if (H < 2 * R) { out.warn.push('Вылет H меньше двух радиусов гиба — такой компенсатор не собрать. Увеличьте H или уменьшите R.'); }
        if (B < 2 * R) { out.warn.push('Спинка B меньше двух радиусов гиба — отводы сойдутся. Увеличьте B или уменьшите R.'); }

        var bd = bend(sec, R);
        out.h = bd.h; out.k = bd.k; out.m1 = bd.m1;
        out.R = R; out.H = H; out.B = B;

        var l1 = Math.max(inp.L1 - (B / 2 + R), 0);
        var l2 = Math.max(inp.L2 - (B / 2 + R), 0);
        out.l1 = l1; out.l2 = l2;
        out.L1 = inp.L1; out.L2 = inp.L2;

        var g = elasticCentre(H, B, R, l1, l2, bd.k);
        out.geom = g;

        // --- усилия и напряжения
        out.Px = (g.Jxs > 0) ? out.delta * out.E * sec.J / g.Jxs : NaN;   // Н
        out.Mmax = out.Px * g.arm;                                        // Н·м
        out.sigma = out.Mmax / sec.W / 1e6;                               // МПа, без m1
        out.sigmaM1 = out.sigma * bd.m1;                                  // МПа, с m1

        // --- допускаемое напряжение
        out.sigmaRd = TABLES.sigmaAt(inp.steel, inp.tWork);
        if (inp.sigmaMode === 'manual') {
            out.sigmaAdm = U.num(inp.sigmaManual);
            out.sigmaAdmWhy = 'задано вручную';
            out.sigmaAdmSrc = null;
        } else if (inp.sigmaMode === 'rd') {
            out.sigmaAdm = out.sigmaRd;
            out.sigmaAdmWhy = steel.sigmaTNote;
            out.sigmaAdmSrc = steel.sigmaTSrc;
        } else {
            out.sigmaAdm = steel.sigmaRef;
            out.sigmaAdmWhy = 'допускаемое напряжение на изгиб для компенсаторов по справочной методике';
            out.sigmaAdmSrc = steel.sigmaRefSrc;
        }

        out.useM1 = !!inp.useM1;
        out.sigmaCheck = out.useM1 ? out.sigmaM1 : out.sigma;
        out.util = out.sigmaCheck / out.sigmaAdm;
        out.ok = out.sigmaCheck <= out.sigmaAdm;

        // --- компенсирующая способность при принятом допускаемом напряжении
        var mUse = out.useM1 ? bd.m1 : 1;
        out.deltaAdm = (g.arm > 0)
            ? 2 * (out.sigmaAdm * 1e6) * g.Jxs / (mUse * out.E * dOut * g.arm)
            : NaN;
        out.dlAdm = out.deltaAdm / (1 - out.stretch);                     // предельное полное удлинение
        out.Lmax = (out.alpha * out.dt > 0) ? out.dlAdm / (out.alpha * out.dt) : NaN;

        // --- кольцевое напряжение от давления (справочно; на изгиб не складывается)
        out.pressMPa = U.num(inp.pressure) || 0;
        out.sigmaHoop = (s > 0) ? out.pressMPa * sec.dIn / (2 * s) : 0;

        // --- массы и погонные нагрузки
        var insThk = (U.num(inp.insThk) || 0) / 1000;
        var insRho = U.num(inp.insRho) || 0;
        out.mPipe = RHO_STEEL * sec.area;
        out.mWater = RHO_WATER * Math.PI / 4 * sec.dIn * sec.dIn;
        out.mIns = (insThk > 0 && insRho > 0) ? insRho * Math.PI * (dOut + insThk) * insThk : 0;
        out.mTotal = out.mPipe + out.mWater + out.mIns;
        out.Gh = out.mTotal * G;                      // вес 1 м в рабочем состоянии, Н/м
        out.Gv = out.Gh;                              // для водяных сетей совпадает

        // --- нагрузки на опоры
        var fr = TABLES.friction(inp.support);
        out.friction = fr;
        out.muX = (inp.muManual > 0) ? U.num(inp.muManual) : fr.mx;
        out.muY = (inp.muManual > 0) ? U.num(inp.muManual) : fr.my;

        out.span = U.num(inp.span) > 0 ? U.num(inp.span) : TABLES.spanFor(inp.dn, insThk > 0);
        out.Fv = out.Gv * out.span;                                   // вертикальная на подвижную опору, Н
        out.Fhy = out.muY * out.Gh * out.span;                        // боковая на подвижную опору, Н

        out.Ffr1 = out.muX * out.Gh * inp.L1;                         // трение с первой стороны, Н
        out.Ffr2 = out.muX * out.Gh * inp.L2;                         // трение со второй стороны, Н

        // концевая неподвижная опора: сумма сил с одной стороны
        out.Nend = out.Px + Math.max(out.Ffr1, out.Ffr2);

        // промежуточная: разность сумм, меньшая — с коэффициентом 0,7
        var s1 = out.Px + out.Ffr1;
        var s2 = out.Px + out.Ffr2;
        var big = Math.max(s1, s2), small = Math.min(s1, s2);
        out.Nmid = (Math.abs(s1 - s2) < 1e-9) ? 0.3 * s1 : (big - 0.7 * small);
        out.NmidRule = (Math.abs(s1 - s2) < 1e-9)
            ? 'силы с обеих сторон равны — по примечанию 2 к п. 5 принята сумма с одной стороны с коэффициентом 0,3'
            : 'по п. 5 — разность сумм, меньшая сумма с коэффициентом 0,7';

        out.gammaF = U.num(inp.gammaF) > 0 ? U.num(inp.gammaF) : 1;
        out.NendCalc = out.Nend * out.gammaF;
        out.NmidCalc = out.Nmid * out.gammaF;
        out.FvCalc = out.Fv * out.gammaF;

        // боковая нагрузка у компенсатора учитывается в пределах 40·Dу (п. 3 прил. 8)
        out.sideZone = 40 * (inp.dn / 1000);

        out.plane = inp.plane === 'v' ? 'v' : 'h';

        // --- этажи и расстановка
        out.floorH = U.num(inp.floorH) || 3;
        out.floors = Math.max(1, Math.round(U.num(inp.floors) || 1));
        out.riserH = out.floorH * out.floors;
        out.floorsPerZone = (out.Lmax > 0 && out.floorH > 0) ? Math.floor(out.Lmax / out.floorH) : 0;
        if (out.floorsPerZone < 1) out.floorsPerZone = 0;
        out.zones = (out.floorsPerZone > 0) ? Math.ceil(out.floors / out.floorsPerZone) : 0;
        out.fixCount = out.zones > 0 ? out.zones + 1 : 0;
        out.compCount = out.zones > 0 ? Math.max(out.zones - 1, 0) : 0;

        // крепления стояка: СП 73.13330.2016 п. 6.1.9
        out.riserStep = (out.floorH > 3) ? out.floorH / 2 : out.floorH;
        out.riserStepWhy = (out.floorH > 3)
            ? 'высота этажа больше 3 м — крепления через половину высоты этажа'
            : 'высота этажа 3 м и меньше — одно крепление на этаж';

        // --- нагрузка на перекрытие
        // На вертикальном стояке ось компенсатора вертикальна: осевая реакция
        // неподвижной опоры тоже вертикальна и целиком приходит на перекрытие.
        out.slabPipeWeight = out.Gh * out.floorH;                  // вес трубы с водой на этаж, Н
        if (out.plane === 'v') {
            out.slabLoad = out.NendCalc + out.slabPipeWeight;
            out.slabWhy = 'вертикальный стояк: осевая реакция неподвижной опоры направлена вдоль стояка, то есть вертикально, и складывается с весом трубы с водой, опирающейся на опору';
        } else {
            out.slabLoad = out.FvCalc;
            out.slabWhy = 'горизонтальная прокладка: на перекрытие через подвижную опору приходит вертикальная нагрузка от веса пролёта; осевая реакция неподвижной опоры действует горизонтально и передаётся на закладную деталь';
        }
        out.slabLoadKgf = out.slabLoad / G;

        // --- предупреждения по геометрии
        var ratio = H / dOut;
        if (ratio < 10) out.notes.push('Вылет H = ' + U.fmt(ratio, 1) + '·Dн. Обычная область применения П-образных компенсаторов — H = (10…40)·Dн; при меньшем вылете компенсатор работает жёстко.');
        if (ratio > 40) out.notes.push('Вылет H = ' + U.fmt(ratio, 0) + '·Dн — заметно больше обычных (10…40)·Dн. Проверьте, не выгоднее ли сильфонный компенсатор или другая разбивка на участки.');
        if (B > 0 && H > 0) {
            var bh = B / H;
            if (bh < 0.4 || bh > 1.6) out.notes.push('Отношение спинки к вылету B/H = ' + U.fmt(bh, 2) + '. В справочных подборках оно держится около 0,8…1,0.');
        }
        if (R < dOut) out.warn.push('Радиус гиба меньше наружного диаметра. СП 124.13330.2012 п. 10.31 требует для заводских крутоизогнутых отводов радиус не менее одного диаметра трубы.');
        if (out.stretch > 0.6) out.notes.push('Растяжка больше 60 % расширения. РД 10-249-98 п. 5.2.8.4 рекомендует для низкотемпературных трубопроводов назначать монтажную растяжку не более 60 %.');
        if (out.dt <= 0) out.warn.push('Рабочая температура не выше монтажной — удлинения нет, расчёт компенсатора смысла не имеет.');

        return out;
    }

    /* ------------------------------------------------------------ подбор вылета */

    /**
     * Наименьший вылет H, при котором напряжение не выходит за допускаемое.
     * Спинка либо задана (bMode = 'fixed'), либо связана с вылетом (bRatio).
     * Возвращает null, если не получается даже при H = 60·Dн.
     */
    function pickH(inp, bMode, bRatio) {
        var dOut = inp.dOut / 1000;
        var lo = 2 * inp.R + 0.001;
        var hi = Math.max(60 * dOut, lo + 0.05);

        function stressAt(H) {
            var trial = {};
            for (var key in inp) if (inp.hasOwnProperty(key)) trial[key] = inp[key];
            trial.H = H;
            trial.B = (bMode === 'fixed') ? inp.B : H * bRatio;
            var r = run(trial);
            return { s: r.sigmaCheck, adm: r.sigmaAdm, res: r };
        }

        var top = stressAt(hi);
        if (!(top.s <= top.adm)) return null;

        for (var i = 0; i < 80; i++) {
            var mid = (lo + hi) / 2;
            var v = stressAt(mid);
            if (isFinite(v.s) && v.s <= v.adm) hi = mid; else lo = mid;
        }
        var best = stressAt(hi);
        return { H: hi, B: (bMode === 'fixed') ? inp.B : hi * bRatio, result: best.res };
    }

    return {
        G: G, RHO_STEEL: RHO_STEEL, RHO_WATER: RHO_WATER,
        section: section, bend: bend, elasticCentre: elasticCentre,
        elongation: elongation, run: run, pickH: pickH
    };
})();
