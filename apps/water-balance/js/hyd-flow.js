/*
    Расход и потери напора для вкладки «Гидравлика».

    Расход участка — по СП 30.13330.2020, раздел 5: нагрузка ниже по течению
    (группы потребителей: норма, U, N) сворачивается накопителем снизу вверх по
    тем же формулам (1), (3), (4), что и Demand.combine, затем α по таблицам Б.1/Б.2
    (Tables.alpha) и q = 5·q0·α. Demand.probability здесь не годится: она жёстко
    берёт общий канал (norm.qhru, norm.q0), а нужны три — общий, горячий, холодный.

    Два способа вероятности:
      people   — P на каждом участке из его U и N (N = U, если приборов нет);
      fixtures — P одна на систему-зону (из полных U и N зоны), по участкам
                 меняется только N.

    Трение: неновая сталь и нержавейка — Шевелёв с запасом dвн−1 мм (как в
    образце, Ø48×3 даёт d=41 мм); полимеры — гладкая труба по Колбруку.
*/

var HydFlow = (function () {
    'use strict';

    var G = 9.81;

    /* --- трение ------------------------------------------------------------ */

    /* d — м, v — м/с. Формула Шевелёва для неновых стальных труб. */
    function lambdaShevelev(dM, v) {
        var d03 = Math.pow(dM, 0.3);
        if (v < 1e-6) v = 1e-6;
        return v >= 1.2 ? 0.021 / d03 : 0.0179 / d03 * Math.pow(1 + 0.867 / v, 0.3);
    }

    /* Колбрук — Уайт, итерациями. kMm — эквивалентная шероховатость. */
    function lambdaColebrook(re, kMm, dM) {
        if (re < 2300) return re > 0 ? 64 / re : 0.05;
        var rel = (kMm / 1000) / (3.7 * dM);
        var lam = 0.02;
        for (var n = 0; n < 40; n++) {
            var x = -2 * Math.log(rel + 2.51 / (re * Math.sqrt(lam))) / Math.LN10;
            var next = 1 / (x * x);
            if (Math.abs(next - lam) < 1e-9) { lam = next; break; }
            lam = next;
        }
        return lam;
    }

    /*
        Внутренний диаметр расчёта, мм: dвн трубы минус запас. reserveMm у
        размера можно задать явно (поле reserve), иначе берётся запас материала.
    */
    function designMm(size, reserveOverride) {
        var mat = HydData.material(size.material);
        var reserve = reserveOverride !== undefined && reserveOverride !== null ? reserveOverride : mat.reserveMm;
        return size.di - reserve;
    }

    /*
        Скорость и удельные потери. q — л/с, dMm — расчётный диаметр, мм,
        mat — материал (ключ), nu — вязкость в 1e-6 м²/с.
        Возвращает { v, re, lambda, i (м/м), iMm (мм/м) }.
    */
    function friction(qLs, dMm, matKey, nu) {
        var d = dMm / 1000;
        var m = HydData.material(matKey);
        var area = Math.PI * d * d / 4;
        var v = area > 0 ? Math.abs(qLs) / 1000 / area : 0;
        var re = v * d / ((nu || 1.0) * 1e-6);
        var lam = m.formula === 'shevelev' ? lambdaShevelev(d, v) : lambdaColebrook(re, m.roughMm, d);
        var i = v > 0 ? lam / d * v * v / (2 * G) : 0;
        return { v: v, re: re, lambda: lam, i: i, iMm: i * 1000 };
    }

    /*
        Подбор диаметра: наименьший размер материала, для которого v ≤ vmax.
        Если ни один не проходит — самый большой (участок помечается снаружи).
        minDn — нижняя граница Ду (в квартире не ставят меньше 15).
    */
    function pickSize(matKey, qLs, vmax, nu, minDn, reserveOverride) {
        var sizes = HydData.sizesOf(matKey);
        var best = null;

        for (var n = 0; n < sizes.length; n++) {
            if (minDn && sizes[n].dn < minDn) continue;
            best = sizes[n];
            var f = friction(qLs, designMm(sizes[n], reserveOverride), matKey, nu);
            if (f.v <= vmax + 1e-9) return { size: sizes[n], ok: true };
        }

        return { size: best, ok: false };
    }

    /* --- параметры канала -------------------------------------------------- */

    /*
        Канал нагрузки: 'total' — общий (холодная + горячая), 'hot' — горячая,
        'cold' — холодная. q0 холодной берётся как у таблицы А.2 (norm.q0c).
    */
    function channelNorm(norm, ch) {
        if (ch === 'hot') return { qhru: norm.qhruh, q0: norm.q0h };
        if (ch === 'cold') return { qhru: norm.qhruc, q0: norm.q0c };
        return { qhru: norm.qhru, q0: norm.q0 };
    }

    /* --- накопитель нагрузки ----------------------------------------------- */

    /*
        Группа нагрузки: { norm, U, N, Nh }. N — приборов всего, Nh — с горячей
        водой. Нулевое N заменяется на U (СП 30, 5.4: приборы неизвестны).
    */
    function groupN(g, ch) {
        if (ch === 'hot') return g.Nh > 0 ? g.Nh : g.U;
        return g.N > 0 ? g.N : g.U;
    }

    /* Вероятность действия приборов группы по формуле (3). */
    function probability(norm, ch, U, N) {
        var c = channelNorm(norm, ch);
        if (!(U > 0) || !(N > 0) || !(c.q0 > 0) || !(c.qhru > 0)) return 0;
        return c.qhru * U / (3600 * c.q0 * N);
    }

    /*
        Свод групп в расход. opts: { node, fixedP, fixedQ0 }.
        Без fixedP — способ «по людям»: P по формулам (3) и (4) из U и N самих групп.
        С fixedP — способ «по приборам»: P задана на систему, меняется только N.
        Возвращает { q, N, U, P, NP, alpha, table, q0 }; q = 0, если нагрузки нет.
    */
    function aggregate(groups, ch, opts) {
        opts = opts || {};

        var sumQhruU = 0;     // Σ q_hr,u · U
        var sumPq0N = 0;      // Σ P · q0 · N
        var sumPN = 0;        // Σ P · N
        var sumQ0N = 0;       // Σ q0 · N (для fixedP)
        var N = 0;
        var U = 0;

        for (var i = 0; i < groups.length; i++) {
            var g = groups[i];
            var cg = ch;

            // Потребитель без горячей воды: из ГВС выпадает, а его холодная вода — общий канал.
            if (g.noHot) {
                if (ch === 'hot') continue;
                if (ch === 'cold') cg = 'total';
            }

            var c = channelNorm(g.norm, cg);
            var n = groupN(g, cg);

            if (!(g.U > 0) || !(n > 0) || !(c.q0 > 0) || !(c.qhru > 0)) continue;

            var p = c.qhru * g.U / (3600 * c.q0 * n);

            sumQhruU += c.qhru * g.U;
            sumPq0N += p * c.q0 * n;
            sumPN += p * n;
            sumQ0N += c.q0 * n;
            N += n;
            U += g.U;
        }

        var empty = { q: 0, N: 0, U: 0, P: 0, NP: 0, alpha: 0, table: '—', q0: 0 };
        if (!(N > 0) || !(sumPN > 0)) return empty;

        var q0, P;

        if (opts.fixedP > 0) {
            q0 = sumQ0N / N;
            P = opts.fixedP;
        } else {
            q0 = sumPq0N / sumPN;                    // (1)
            P = sumQhruU / (3600 * q0 * N);          // (4)
        }

        var alpha = Tables.alpha(N, P, !!opts.node);

        return { q: 5 * q0 * alpha, N: N, U: U, P: P, NP: N * P, alpha: alpha, table: Tables.tableOf(N, P), q0: q0 };
    }

    return {
        G: G,
        lambdaShevelev: lambdaShevelev,
        lambdaColebrook: lambdaColebrook,
        designMm: designMm,
        friction: friction,
        pickSize: pickSize,
        channelNorm: channelNorm,
        probability: probability,
        aggregate: aggregate
    };
})();
