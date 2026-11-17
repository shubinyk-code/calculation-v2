'use strict';

/*
    Связка: форма → расчёт → схемы, отчёт, таблицы, выгрузка.
    Ничего вычислительного здесь нет, только сбор данных и вывод.
*/

var App = (function () {

    var el = {};
    var state = null;      // последний результат Calc.run
    var lastInput = null;

    function $(id) { return document.getElementById(id); }

    /* ------------------------------------------------------------ значения по умолчанию */

    function defaults() {
        return {
            object: '', system: '',
            sort: 'esw', dn: 100, dOut: 108, s: 4,
            steel: 'st20',
            pressure: 0.6,
            tInstall: 10, tWork: 95,
            L: 27, L1: 13.5, L2: 13.5, sym: true,
            stretch: 0.5,
            plane: 'v',
            rPreset: '1.5dn', R: 0.15,
            H: 1.5, B: 1.275, bMode: 'ratio', bRatio: 0.85,
            sigmaMode: 'ref', sigmaManual: '', useM1: true, EManual: '',
            support: 'slide', muManual: '', span: '',
            insThk: 0, insRho: 80,
            gammaF: 1,
            floors: 9, floorH: 3
        };
    }

    /* ------------------------------------------------------------ заполнение списков */

    function fillSelects() {
        var sort = el.fSort;
        sort.innerHTML = '';
        Object.keys(TABLES.SORTS).forEach(function (key) {
            var o = document.createElement('option');
            o.value = key; o.textContent = TABLES.SORTS[key].name;
            sort.appendChild(o);
        });

        var steel = el.fSteel;
        steel.innerHTML = '';
        Object.keys(TABLES.STEELS).forEach(function (key) {
            var o = document.createElement('option');
            o.value = key; o.textContent = TABLES.STEELS[key].name;
            steel.appendChild(o);
        });

        var sup = el.fSupport;
        sup.innerHTML = '';
        TABLES.FRICTION.forEach(function (fr) {
            var o = document.createElement('option');
            o.value = fr.id; o.textContent = fr.name + ' (μ = ' + U.fmt(fr.mx, 2) + ')';
            sup.appendChild(o);
        });
    }

    function fillDn(sortId, keepDn) {
        var rows = TABLES.pipeRows(sortId);
        el.fDn.innerHTML = '';
        rows.forEach(function (r) {
            var o = document.createElement('option');
            o.value = String(r.dn);
            o.textContent = r.dn + '  (' + U.fmt(r.d, 1) + '×' + U.fmt(r.s, 1) + ')';
            el.fDn.appendChild(o);
        });
        var has = rows.some(function (r) { return r.dn === keepDn; });
        el.fDn.value = String(has ? keepDn : rows[Math.min(3, rows.length - 1)].dn);
    }

    /* ------------------------------------------------------------ форма */

    function setForm(v) {
        el.fObject.value = v.object;
        el.fSystem.value = v.system;
        el.fSort.value = v.sort;
        fillDn(v.sort, v.dn);
        el.fDout.value = U.fmt(v.dOut, 1);
        el.fS.value = U.fmt(v.s, 1);
        el.fSteel.value = v.steel;
        el.fPress.value = U.fmt(v.pressure, 2);
        el.fTinst.value = U.fmt(v.tInstall, 0);
        el.fTwork.value = U.fmt(v.tWork, 0);
        el.fL.value = U.fmt(v.L, 2);
        el.fL1.value = U.fmt(v.L1, 2);
        el.fL2.value = U.fmt(v.L2, 2);
        el.fSym.checked = !!v.sym;
        el.fStretch.value = U.fmt(v.stretch * 100, 0);
        el.fPlane.value = v.plane;
        el.fRpreset.value = v.rPreset;
        el.fR.value = U.fmt(v.R * 1000, 0);
        el.fH.value = U.fmt(v.H * 1000, 0);
        el.fB.value = U.fmt(v.B * 1000, 0);
        el.fBmode.value = v.bMode;
        el.fBratio.value = U.fmt(v.bRatio, 2);
        var radios = document.getElementsByName('sigmaMode');
        for (var i = 0; i < radios.length; i++) radios[i].checked = (radios[i].value === v.sigmaMode);
        el.fSigmaMan.value = v.sigmaManual;
        el.fUseM1.checked = !!v.useM1;
        el.fE.value = v.EManual;
        el.fSupport.value = v.support;
        el.fMu.value = v.muManual;
        el.fSpan.value = v.span;
        el.fInsThk.value = U.fmt(v.insThk, 0);
        el.fInsRho.value = U.fmt(v.insRho, 0);
        el.fGammaF.value = U.fmt(v.gammaF, 2);
        el.fFloors.value = String(v.floors);
        el.fFloorH.value = U.fmt(v.floorH, 2);
    }

    function readForm() {
        var sigmaMode = 'ref';
        var radios = document.getElementsByName('sigmaMode');
        for (var i = 0; i < radios.length; i++) if (radios[i].checked) sigmaMode = radios[i].value;

        var inp = {
            object: el.fObject.value.trim(),
            system: el.fSystem.value.trim(),
            sort: el.fSort.value,
            dn: U.num(el.fDn.value) || 100,
            dOut: U.num(el.fDout.value) || 108,
            s: U.num(el.fS.value) || 4,
            steel: el.fSteel.value,
            pressure: U.num(el.fPress.value) || 0,
            tInstall: U.num(el.fTinst.value),
            tWork: U.num(el.fTwork.value),
            L: U.num(el.fL.value) || 0,
            L1: U.num(el.fL1.value) || 0,
            L2: U.num(el.fL2.value) || 0,
            sym: el.fSym.checked,
            stretch: (U.num(el.fStretch.value) || 0) / 100,
            plane: el.fPlane.value,
            rPreset: el.fRpreset.value,
            R: (U.num(el.fR.value) || 0) / 1000,
            H: (U.num(el.fH.value) || 0) / 1000,
            B: (U.num(el.fB.value) || 0) / 1000,
            bMode: el.fBmode.value,
            bRatio: U.num(el.fBratio.value) || 0.85,
            sigmaMode: sigmaMode,
            sigmaManual: el.fSigmaMan.value,
            useM1: el.fUseM1.checked,
            EManual: U.num(el.fE.value) || 0,
            support: el.fSupport.value,
            muManual: U.num(el.fMu.value) || 0,
            span: el.fSpan.value,
            insThk: U.num(el.fInsThk.value) || 0,
            insRho: U.num(el.fInsRho.value) || 0,
            gammaF: U.num(el.fGammaF.value) || 1,
            floors: U.num(el.fFloors.value) || 1,
            floorH: U.num(el.fFloorH.value) || 3
        };

        if (isNaN(inp.tInstall)) inp.tInstall = 10;
        if (isNaN(inp.tWork)) inp.tWork = 95;
        if (inp.sym) { inp.L1 = inp.L / 2; inp.L2 = inp.L / 2; }
        // спинка, связанная с вылетом, округляется вверх до 10 мм: чертёжный
        // размер должен быть круглым, а больший B только снижает напряжение
        if (inp.bMode === 'ratio') inp.B = Math.ceil(inp.H * inp.bRatio * 100) / 100;
        return inp;
    }

    /** Подставить R по выбранному правилу. */
    function applyRPreset() {
        var preset = el.fRpreset.value;
        if (preset === 'man') return;
        var dOut = U.num(el.fDout.value) || 108;
        var dn = U.num(el.fDn.value) || 100;
        var R;
        if (preset === '1.5dn') R = 1.5 * dn;
        else R = parseFloat(preset) * dOut;
        el.fR.value = U.fmt(R, 0);
    }

    /* ------------------------------------------------------------ вывод */

    function kpi(label, value, unit, cls) {
        return '<div class="kpi' + (cls ? ' ' + cls : '') + '"><span class="k">' + U.esc(label) +
            '</span><span class="v">' + U.esc(value) +
            (unit ? ' <span class="u">' + U.esc(unit) + '</span>' : '') + '</span></div>';
    }

    function render() {
        var inp = readForm();
        lastInput = inp;
        var res = Calc.run(inp);
        state = res;

        // синхронизировать поле B, если оно связано с H
        if (inp.bMode === 'ratio') el.fB.value = U.fmt(res.B * 1000, 0);
        if (inp.sym) { el.fL1.value = U.fmt(inp.L1, 2); el.fL2.value = U.fmt(inp.L2, 2); }
        el.fB.disabled = (inp.bMode === 'ratio');
        el.fBratio.disabled = (inp.bMode !== 'ratio');
        el.fL1.disabled = inp.sym;
        el.fL2.disabled = inp.sym;
        el.fR.disabled = (el.fRpreset.value !== 'man');
        el.fSigmaMan.disabled = (inp.sigmaMode !== 'manual');

        // ------ показатели
        var okCls = res.ok ? 'ok' : 'no';
        var html = '';
        html += kpi('Удлинение Δl', U.fmt(res.dl * 1000, 1), 'мм');
        html += kpi('Расчётное перемещение Δ', U.fmt(res.delta * 1000, 1), 'мм');
        html += kpi('Сила упругого отпора Px', U.fmt(res.Px / 1000, 2), 'кН');
        html += kpi('Напряжение σ', U.fmt(res.sigmaCheck, 1), 'МПа', okCls);
        html += kpi('Допускаемое [σ]', U.fmt(res.sigmaAdm, 0), 'МПа');
        html += kpi('Компенсир. способность', U.fmt(res.deltaAdm * 1000, 1), 'мм');
        html += kpi('Предельная длина участка', U.fmt(res.Lmax, 1), 'м');
        html += kpi('Нагрузка на концевую Н.О.', U.fmt(res.NendCalc / 1000, 2), 'кН');
        html += kpi('Нагрузка на перекрытие', U.fmt(res.slabLoad / 1000, 2), 'кН');
        html += kpi('Масса 1 м в работе', U.fmt(res.mTotal, 1), 'кг/м');
        el.kpis.innerHTML = html;

        var v = el.verdict;
        v.className = 'verdict ' + (res.ok ? 'ok' : 'no');
        v.innerHTML = res.ok
            ? '<b>Проходит.</b> σ = ' + U.fmt(res.sigmaCheck, 1) + ' МПа ≤ [σ] = ' + U.fmt(res.sigmaAdm, 0) +
              ' МПа (использование ' + U.fmt(res.util * 100, 0) + ' %). Компенсатор воспринимает ' +
              U.fmt(res.deltaAdm * 1000, 1) + ' мм при требуемых ' + U.fmt(res.delta * 1000, 1) + ' мм.'
            : '<b>Не проходит.</b> σ = ' + U.fmt(res.sigmaCheck, 1) + ' МПа > [σ] = ' + U.fmt(res.sigmaAdm, 0) +
              ' МПа. Нужен вылет больше (нажмите «Подобрать вылет H»), либо участок короче ' +
              U.fmt(res.Lmax, 2) + ' м, либо растяжка больше.';
        el.verdictShort.textContent = res.ok
            ? 'использование ' + U.fmt(res.util * 100, 0) + ' %'
            : 'превышение в ' + U.fmt(res.util, 2) + ' раза';

        var wb = '';
        if (res.warn.length) {
            wb += '<div class="warnbox">' + res.warn.map(function (w) {
                return '<div><b>!</b> ' + U.esc(w) + '</div>'; }).join('') + '</div>';
        }
        if (res.notes.length) {
            wb += '<div class="muted small" style="margin-top:8px">' + res.notes.map(function (w) {
                return '<div>· ' + U.esc(w) + '</div>'; }).join('') + '</div>';
        }
        el.warnbox.innerHTML = wb;

        el.sigmaWhy.textContent = '[σ] = ' + U.fmt(res.sigmaAdm, 1) + ' МПа — ' + res.sigmaAdmWhy +
            '. Для справки: по РД 10-249-98 при ' + U.fmt(inp.tWork, 0) + ' °C номинальное [σ] = ' +
            U.fmt(res.sigmaRd, 0) + ' МПа; коэффициент m₁ = ' + U.fmt(res.m1, 2) + '.';

        // ------ схема узла
        var w = Math.max(el.nodeSvg.clientWidth || 860, 520);
        el.nodeSvg.innerHTML = Scheme.node(res, { width: w, maxH: res.plane === 'v' ? 520 : 400 });

        // ------ отчёт
        var text = Report.build(inp, res);
        el.report.textContent = text;

        renderRiser(res);
        renderLoads(res);
    }

    function renderRiser(res) {
        var html = '';
        html += kpi('Высота стояка', U.fmt(res.riserH, 2), 'м');
        html += kpi('Предельная длина участка', U.fmt(res.Lmax, 2), 'м');
        html += kpi('Этажей на участок', res.floorsPerZone > 0 ? String(res.floorsPerZone) : '—', '',
            res.floorsPerZone > 0 ? '' : 'no');
        html += kpi('Компенсирующих участков', res.zones > 0 ? String(res.zones) : '—', '');
        html += kpi('Неподвижных опор', res.fixCount > 0 ? String(res.fixCount) : '—', '');
        html += kpi('Шаг креплений', U.fmt(res.riserStep, 2), 'м');
        html += kpi('Нагрузка на перекрытие', U.fmt(res.slabLoad / 1000, 2), 'кН');
        html += kpi('То же в кгс', U.fmt(res.slabLoadKgf, 0), 'кгс');
        el.riserKpis.innerHTML = html;

        var rv = el.riserVerdict;
        if (res.floorsPerZone > 0) {
            rv.className = 'verdict ok';
            rv.innerHTML = '<b>Расстановка:</b> неподвижные опоры через ' + res.floorsPerZone +
                ' эт. (' + U.fmt(res.floorsPerZone * res.floorH, 2) + ' м), между ними по одному П-образному ' +
                'компенсатору H = ' + U.fmt(res.H * 1000, 0) + ' мм, B = ' + U.fmt(res.B * 1000, 0) + ' мм. ' +
                'Всего на ' + res.floors + ' эт.: ' + res.zones + ' участк(а/ов), ' + res.fixCount +
                ' неподвижных опор, ' + res.zones + ' компенсатор(а/ов).';
        } else {
            rv.className = 'verdict no';
            rv.innerHTML = '<b>Не получается.</b> Принятый компенсатор не воспринимает удлинение даже ' +
                'одного этажа высотой ' + U.fmt(res.floorH, 2) + ' м. Увеличьте вылет H или спинку B.';
        }

        el.riserSvg.innerHTML = Scheme.riser(res, { rowH: 52 });
    }

    function renderLoads(res) {
        var rows = [
            ['Вес 1 м в рабочем состоянии Gh = Gv', U.fmt(res.Gh, 1) + ' Н/м',
                'Gh = g·(mтр + mвода + mизол)', 'прил. 8 п. 1, п. 2'],
            ['Пролёт между подвижными опорами l', U.fmt(res.span, 2) + ' м',
                'по Dу', 'СП 73.13330.2016, табл. 2'],
            ['Вертикальная на подвижную опору Fv', U.fmt(res.Fv / 1000, 2) + ' кН',
                'Fv = Gv·l', 'прил. 8, ф. (1)'],
            ['Боковая на подвижную опору Fhy', U.fmt(res.Fhy / 1000, 2) + ' кН',
                'Fhy = μy·Gh·l', 'прил. 8, ф. (3)'],
            ['Трение на плече L1', U.fmt(res.Ffr1 / 1000, 2) + ' кН',
                'Fтр = μx·Gh·L1', 'прил. 8, ф. (5)'],
            ['Трение на плече L2', U.fmt(res.Ffr2 / 1000, 2) + ' кН',
                'Fтр = μx·Gh·L2', 'прил. 8, ф. (5)'],
            ['Сила упругого отпора компенсатора Px', U.fmt(res.Px / 1000, 2) + ' кН',
                'Px = Δ·E·J/Jxs', 'прил. 8 п. 4.7; расчёт по Громову/Шубину'],
            ['Концевая неподвижная опора', U.fmt(res.Nend / 1000, 2) + ' кН',
                'N = Px + Fтр', 'прил. 8, п. 5'],
            ['Промежуточная неподвижная опора', U.fmt(res.Nmid / 1000, 2) + ' кН',
                'разность сумм, меньшая ×0,7', 'прил. 8, п. 5'],
            ['Коэффициент надёжности γf', U.fmt(res.gammaF, 2),
                'задаётся пользователем', 'в прил. 8 нагрузки нормативные'],
            ['Расчётная на концевую Н.О.', U.fmt(res.NendCalc / 1000, 2) + ' кН', 'N·γf', '—'],
            ['Расчётная на промежуточную Н.О.', U.fmt(res.NmidCalc / 1000, 2) + ' кН', 'N·γf', '—'],
            ['Зона учёта боковых нагрузок', U.fmt(res.sideZone, 1) + ' м', '40·Dу', 'прил. 8, п. 3'],
            ['Вес трубы с водой на этаж', U.fmt(res.slabPipeWeight / 1000, 2) + ' кН', 'Gh·hэт', '—'],
            ['Нагрузка на перекрытие в узле опоры', U.fmt(res.slabLoad / 1000, 2) + ' кН',
                res.plane === 'v' ? 'N + Gh·hэт (ось вертикальна)' : 'Fv', 'см. пояснение ниже']
        ];
        var tb = el.tLoads.tBodies[0];
        tb.innerHTML = rows.map(function (r) {
            return '<tr><td class="l wrap">' + U.esc(r[0]) + '</td><td>' + U.esc(r[1]) +
                '</td><td class="l wrap">' + U.esc(r[2]) + '</td><td class="l wrap muted">' + U.esc(r[3]) + '</td></tr>';
        }).join('');
    }

    /* ------------------------------------------------------------ справочники */

    function renderRefs() {
        var sortId = el.fSort.value;
        var sort = TABLES.SORTS[sortId];
        el.sortSrc.textContent = SRC[sort.src].code;
        el.tPipes.tBodies[0].innerHTML = sort.rows.map(function (r) {
            var sec = Calc.section(r.d / 1000, r.s / 1000);
            var mp = Calc.RHO_STEEL * sec.area;
            var mw = Calc.RHO_WATER * Math.PI / 4 * sec.dIn * sec.dIn;
            return '<tr><td>' + r.dn + '</td><td>' + U.fmt(r.d, 1) + '</td><td>' + U.fmt(r.s, 1) +
                '</td><td>' + U.fmt(sec.dIn * 1000, 1) + '</td><td>' + U.fmt(mp, 2) +
                '</td><td>' + U.fmt(mw, 2) + '</td></tr>';
        }).join('');

        var temps = [20, 100, 150, 200, 250, 300];
        el.tSteel.tBodies[0].innerHTML = Object.keys(TABLES.STEELS).map(function (key) {
            var st = TABLES.STEELS[key];
            var cells = temps.map(function (t) { return '<td>' + U.fmt(U.interp(st.sigmaT, t), 0) + '</td>'; }).join('');
            return '<tr><td class="l">' + U.esc(st.name) + '</td>' + cells +
                '<td><b>' + U.fmt(st.sigmaRef, 0) + '</b></td></tr>';
        }).join('');

        var tt = [20, 100, 150, 200, 250, 300, 350, 400];
        function line(label, tbl, mul, dg) {
            return '<tr><td class="l">' + label + '</td>' + tt.map(function (t) {
                return '<td>' + U.fmt(U.interp(tbl, t) * mul, dg) + '</td>';
            }).join('') + '</tr>';
        }
        el.tAlpha.tBodies[0].innerHTML =
            line('α·10⁻⁶, 1/K — углеродистые и низколегированные', TABLES.ALPHA.carbon, 1, 1) +
            line('E·10⁵, МПа — Ст3, 20, 20К, 22К', TABLES.EMOD.carbon, 1, 2) +
            line('E·10⁵, МПа — 09Г2С, 16ГС', TABLES.EMOD.lowalloy, 1, 2);

        el.tFric.tBodies[0].innerHTML = TABLES.FRICTION.map(function (fr) {
            return '<tr><td class="l">' + U.esc(fr.name) + '</td><td>' + U.fmt(fr.mx, 2) +
                '</td><td>' + U.fmt(fr.my, 2) + '</td><td class="l muted">' + U.esc(SRC[fr.src].code) + '</td></tr>';
        }).join('');

        el.tSpan.tBodies[0].innerHTML = TABLES.SPAN_SP73.map(function (r) {
            return '<tr><td>' + r.dn + '</td><td>' + U.fmt(r.bare, 1) + '</td><td>' + U.fmt(r.ins, 1) + '</td></tr>';
        }).join('');

        el.tLfix.tBodies[0].innerHTML = TABLES.LFIX.map(function (r) {
            return '<tr><td>' + r.dn + '</td><td>' + r.l + '</td></tr>';
        }).join('');
    }

    function renderSources() {
        el.srcList.innerHTML = Report.sourceList().map(function (s) {
            return '<div class="src-item">' +
                '<span class="code">' + U.esc(s.code) + '</span>' +
                '<span class="ttl">' + U.esc(s.title) + '</span>' +
                '<span class="use"><b>Что взято:</b> ' + U.esc(s.use) + '</span>' +
                '<span class="use muted">' + U.esc(s.pub) + '</span>' +
                (s.url ? '<span class="lnk"><a href="' + U.esc(s.url) + '" target="_blank" rel="noopener">' +
                    U.esc(s.url) + '</a></span>' : '<span class="lnk muted">печатное издание, ссылки нет</span>') +
                '</div>';
        }).join('');
    }

    var FORMULAS = [
        ['Температурное удлинение', 'Δl = α · L · Δt', 'rd249',
            'α — средний коэффициент линейного расширения в интервале 20…t.'],
        ['Расчётное перемещение с растяжкой', 'Δ = Δl · (1 − e),  при 50 % растяжке e = 0,5', 'rd400',
            'РД 10-400-01, прил. 3, п. 3.3.'],
        ['Характеристика гиба отвода', 'h = s · R / r²ср,   rср = (Dн − s)/2', 'gromov', ''],
        ['Коэффициент жёсткости (Кармана)', 'k = (1 + 12h²) / (10 + 12h²) ≤ 1', 'gromov',
            'Сверено с табл. № 1 статьи Горуновича: 89×3,5 → 0,154; 159×6 → 0,154; 325×10 → 0,134; 630×12 → 0,106.'],
        ['Приведённая длина отвода', 'lпр = (π·R·α°/180) / k', 'gorunovich',
            'Отвод гибче прямой трубы, поэтому приведённая длина всегда больше фактической.'],
        ['Приведённая длина оси', 'Lпр = Σ прямых + Σ приведённых дуг + плечи', 'gromov', ''],
        ['Упругий центр', 'ys = ∫ y ds / Lпр', 'gromov',
            'Интегралы берутся по спинке, четырём отводам, двум вылетам; плечи лежат на y = 0.'],
        ['Момент инерции упругой линии', 'Jxs = ∫ y² ds − Lпр · y²s', 'gromov', ''],
        ['Сила упругого отпора', 'Px = Δ · E · J / Jxs', 'gromov',
            'Следствие теоремы Кастилиано после переноса осей в упругий центр.'],
        ['Максимальный момент', 'Mmax = Px · (H − ys)', 'gorunovich', 'Действует в спинке компенсатора.'],
        ['Напряжение', 'σ = m₁ · Mmax / W,   W = π(D⁴н − D⁴вн)/(32·Dн)', 'gorunovich', ''],
        ['Коэффициент интенсификации', 'm₁ = 0,9 / h^(2/3) ≥ 1', 'gorunovich',
            'Для гнутых отводов. Можно отключить — см. «границы применимости».'],
        ['Компенсирующая способность', 'Δдоп = 2 · [σ] · Jxs / (m₁ · E · Dн · (H − ys))', 'gromov',
            'Обратная задача к Px: перемещение, при котором σ равно допускаемому.'],
        ['Предельная длина участка', 'Lmax = Δдоп / ((1 − e) · α · Δt)', 'gromov', ''],
        ['Вертикальная нагрузка на опору', 'Fv = Gv · l', 'snip0407', 'Приложение 8, формула (1).'],
        ['Горизонтальные от трения', 'Fhx = μx·Gh·l;  Fhy = μy·Gh·l;  Fтр = μ·Gh·L', 'snip0407',
            'Приложение 8, формулы (2), (3), (5).'],
        ['Нагрузка на неподвижную опору', 'концевая: N = ΣF;  промежуточная: N = ΣFб − 0,7·ΣFм', 'snip0407',
            'Приложение 8, п. 5. При равных суммах — 0,3·ΣF (примечание 2).'],
        ['Кольцевое напряжение (справочно)', 'σкц = P · Dвн / (2s)', 'rd249',
            'На П-образный компенсатор распорного усилия давление не даёт.']
    ];

    function renderFormulas() {
        el.formulas.innerHTML = FORMULAS.map(function (f) {
            var s = SRC[f[2]];
            return '<div class="fml"><b>' + U.esc(f[0]) + '</b><code>' + U.esc(f[1]) + '</code>' +
                (f[3] ? '<span class="src">' + U.esc(f[3]) + '</span>' : '') +
                '<span class="src">Источник: ' + U.esc(s.code) + '</span></div>';
        }).join('');
    }

    /* ------------------------------------------------------------ контрольный пример */

    function benchSigma(dOut, s, H, B, R, b, delta) {
        var sec = Calc.section(dOut / 1000, s / 1000);
        var bd = Calc.bend(sec, R);
        var arm = b - (B / 2 + R);
        var g = Calc.elasticCentre(H, B, R, arm, arm, bd.k);
        var Px = delta * 2e11 * sec.J / g.Jxs;
        var sig = Px * g.arm / sec.W / 1e6;
        return { k: bd.k, m1: bd.m1, sigma: sig, sigmaM1: sig * bd.m1, Px: Px };
    }

    var BENCH = [
        { name: '108×4', d: 108, s: 4, H: 1.2, B: 1.1, b: 2.6, R: 0.15, dl: 0.05, ref: 284 },
        { name: '159×6', d: 159, s: 6, H: 1.8, B: 1.56, b: 3.52, R: 0.225, dl: 0.06, ref: 226 },
        { name: '325×10', d: 325, s: 10, H: 3.6, B: 3.1, b: 6.8, R: 0.45, dl: 0.13, ref: 266 },
        { name: '530×12', d: 530, s: 12, H: 6, B: 5, b: 11, R: 0.5, dl: 0.175, ref: 358.8 }
    ];

    function renderBench() {
        el.tBench.tBodies[0].innerHTML = BENCH.map(function (c) {
            var r = benchSigma(c.d, c.s, c.H, c.B, c.R, c.b, c.dl);
            var diff = (r.sigmaM1 - c.ref) / c.ref * 100;
            return '<tr><td class="l">' + c.name + '</td><td>' + U.fmt(c.H, 2) + '</td><td>' + U.fmt(c.B, 2) +
                '</td><td>' + U.fmt(c.b, 2) + '</td><td>' + U.fmt(c.R, 3) + '</td><td>' + U.fmt(c.dl, 3) +
                '</td><td>' + U.fmt(c.ref, 1) + '</td><td>' + U.fmt(r.sigmaM1, 1) +
                '</td><td class="' + (Math.abs(diff) <= 5 ? 'st-ok' : 'st-warn') + '">' +
                (diff >= 0 ? '+' : '') + U.fmt(diff, 1) + ' %</td></tr>';
        }).join('');
    }

    /* ------------------------------------------------------------ выгрузка */

    function fileBase() {
        var s = (lastInput && lastInput.object ? lastInput.object + '_' : '') + 'компенсатор_' +
            U.fmt(state.sec.dOut * 1000, 0) + 'x' + U.fmt(state.sec.s * 1000, 0);
        return s.replace(/[\\/:*?"<>|]/g, '-');
    }

    function exportDxfNode() {
        U.save(fileBase() + '_узел.dxf', new Blob([Dxf.nodeDxf(state)], { type: 'application/dxf' }));
        toast('DXF узла сохранён');
    }

    function exportDxfRiser() {
        U.save(fileBase() + '_стояк.dxf', new Blob([Dxf.riserDxf(state)], { type: 'application/dxf' }));
        toast('DXF стояка сохранён');
    }

    function exportPdf() {
        toast('Собираю PDF…');
        el.btnPdf.disabled = true;
        var text = Report.build(lastInput, state);
        PdfOut.build(lastInput, state, text).then(function (bytes) {
            U.save(fileBase() + '.pdf', new Blob([bytes], { type: 'application/pdf' }));
            toast('PDF сохранён');
        }).catch(function (e) {
            console.error(e);
            toast('PDF собрать не удалось — откроется печать');
            doPrint();
        }).then(function () { el.btnPdf.disabled = false; });
    }

    function doPrint() {
        var res = state;
        var text = Report.build(lastInput, res);
        var html = '';
        html += '<div class="pr-page">';
        html += '<h1 class="pr-h1">Расчёт стального П-образного компенсатора</h1>';
        html += '<p class="pr-sub">' + U.esc(U.today()) +
            (lastInput.object ? ' · ' + U.esc(lastInput.object) : '') +
            (lastInput.system ? ' · ' + U.esc(lastInput.system) : '') + '</p>';
        html += Scheme.node(res, { mode: 'light', width: 900, maxH: 420 });
        html += '<h2 class="pr-h2">Расчёт</h2>';
        html += '<pre class="pr-pre">' + U.esc(text.split('\nИСТОЧНИКИ')[0]) + '</pre>';
        html += '</div>';
        html += '<div class="pr-page">';
        html += '<h2 class="pr-h2">Схема стояка</h2>';
        html += Scheme.riser(res, { mode: 'light', rowH: 40 });
        html += '<h2 class="pr-h2">Источники</h2><ol class="pr-src">';
        Report.sourceList().forEach(function (s) {
            html += '<li><b>' + U.esc(s.code) + '.</b> ' + U.esc(s.title) + ' — ' + U.esc(s.pub) +
                (s.url ? '. ' + U.esc(s.url) : '') + '</li>';
        });
        html += '</ol></div>';
        el.printroot.innerHTML = html;
        window.print();
    }

    function saveProject() {
        var data = { format: 'CompensatorWeb', version: 1, saved: U.today(), input: readForm() };
        U.save(fileBase() + '.pkomp', JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
        toast('Исходные данные сохранены');
    }

    function openProject(file) {
        var rd = new FileReader();
        rd.onload = function () {
            try {
                var data = JSON.parse(rd.result);
                var v = data.input || data;
                var base = defaults();
                Object.keys(base).forEach(function (k) { if (v[k] !== undefined) base[k] = v[k]; });
                setForm(base);
                applyRPreset();
                render();
                renderRefs();
                toast('Открыто: ' + file.name);
            } catch (e) {
                toast('Файл не читается');
            }
        };
        rd.readAsText(file, 'utf-8');
    }

    /* ------------------------------------------------------------ прочее */

    var toastTimer = null;
    function toast(msg) {
        el.toast.textContent = msg;
        el.toast.classList.add('on');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.toast.classList.remove('on'); }, 2200);
    }

    function showTab(id) {
        var tabs = document.querySelectorAll('.tab');
        for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].id === 'tab-' + id);
        var btns = document.querySelectorAll('.tabs-nav button');
        for (var j = 0; j < btns.length; j++) btns[j].classList.toggle('on', btns[j].dataset.tab === id);
        if (id === 'calc') render();
    }

    /* ------------------------------------------------------------ запуск */

    function init() {
        ['fObject', 'fSystem', 'fSort', 'fDn', 'fDout', 'fS', 'fSteel', 'fPress', 'fTinst', 'fTwork',
            'fL', 'fL1', 'fL2', 'fSym', 'fStretch', 'fPlane', 'fRpreset', 'fR', 'fH', 'fB', 'fBmode',
            'fBratio', 'fSigmaMan', 'fUseM1', 'fE', 'fSupport', 'fMu', 'fSpan', 'fInsThk', 'fInsRho',
            'fGammaF', 'fFloors', 'fFloorH', 'fFile',
            'kpis', 'verdict', 'verdictShort', 'warnbox', 'sigmaWhy', 'nodeSvg', 'report',
            'riserKpis', 'riserVerdict', 'riserSvg', 'tLoads', 'tPipes', 'tSteel', 'tAlpha',
            'tFric', 'tSpan', 'tLfix', 'sortSrc', 'srcList', 'formulas', 'tBench',
            'btnPick', 'btnPdf', 'btnPrint', 'btnDxfNode', 'btnDxfRiser', 'btnDxfRiser2',
            'btnSave', 'btnOpen', 'btnReset', 'printroot', 'toast'
        ].forEach(function (id) { el[id] = $(id); });

        fillSelects();
        setForm(defaults());
        applyRPreset();

        // при первом запуске сразу подобрать вылет, чтобы страница открылась «рабочей»
        pickH(true);

        renderRefs();
        renderSources();
        renderFormulas();
        renderBench();
        render();

        // ------ события
        var recalcIds = ['fObject', 'fSystem', 'fDout', 'fS', 'fPress', 'fTinst', 'fTwork', 'fL',
            'fL1', 'fL2', 'fStretch', 'fH', 'fB', 'fBratio', 'fSigmaMan', 'fE', 'fMu', 'fSpan',
            'fInsThk', 'fInsRho', 'fGammaF', 'fFloors', 'fFloorH'];
        recalcIds.forEach(function (id) { el[id].addEventListener('input', render); });

        ['fSteel', 'fPlane', 'fBmode', 'fSupport', 'fSym', 'fUseM1'].forEach(function (id) {
            el[id].addEventListener('change', render);
        });
        var radios = document.getElementsByName('sigmaMode');
        for (var i = 0; i < radios.length; i++) radios[i].addEventListener('change', render);

        el.fSort.addEventListener('change', function () {
            fillDn(el.fSort.value, U.num(el.fDn.value));
            onDnChange();
            renderRefs();
        });
        el.fDn.addEventListener('change', onDnChange);
        el.fRpreset.addEventListener('change', function () { applyRPreset(); render(); });

        el.btnPick.addEventListener('click', function () { pickH(false); render(); });
        el.btnPdf.addEventListener('click', exportPdf);
        el.btnPrint.addEventListener('click', doPrint);
        el.btnDxfNode.addEventListener('click', exportDxfNode);
        el.btnDxfRiser.addEventListener('click', exportDxfRiser);
        el.btnDxfRiser2.addEventListener('click', exportDxfRiser);
        el.btnSave.addEventListener('click', saveProject);
        el.btnOpen.addEventListener('click', function () { el.fFile.click(); });
        el.fFile.addEventListener('change', function () {
            if (this.files && this.files[0]) openProject(this.files[0]);
            this.value = '';
        });
        el.btnReset.addEventListener('click', function () {
            setForm(defaults()); applyRPreset(); pickH(true); render(); renderRefs();
            toast('Исходные данные сброшены');
        });

        var btns = document.querySelectorAll('.tabs-nav button');
        for (var b = 0; b < btns.length; b++) {
            (function (btn) { btn.addEventListener('click', function () { showTab(btn.dataset.tab); }); })(btns[b]);
        }
        showTab('calc');

        var resizeTimer = null;
        window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(render, 180);
        });
    }

    function onDnChange() {
        var row = TABLES.findPipe(el.fSort.value, U.num(el.fDn.value));
        el.fDout.value = U.fmt(row.d, 1);
        el.fS.value = U.fmt(row.s, 1);
        applyRPreset();
        render();
    }

    /** Подобрать вылет; silent — без сообщения (при старте). */
    function pickH(silent) {
        var inp = readForm();
        var found = Calc.pickH(inp, inp.bMode === 'fixed' ? 'fixed' : 'ratio', inp.bRatio);
        if (!found) {
            if (!silent) toast('Не подобрать: даже при H = 60·Dн напряжение выше допускаемого');
            return;
        }
        // округляем вверх до 10 мм: иначе «подобранный» вылет после округления
        // вниз даёт напряжение на десятые доли выше допускаемого
        var Hmm = Math.ceil(found.H * 1000 / 10) * 10;
        el.fH.value = U.fmt(Hmm, 0);
        if (inp.bMode === 'ratio') el.fB.value = U.fmt(Math.ceil(Hmm * inp.bRatio / 10) * 10, 0);
        if (!silent) toast('Вылет H = ' + U.fmt(Hmm, 0) + ' мм');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    return {
        render: render, readForm: readForm, benchSigma: benchSigma, BENCH: BENCH,
        get state() { return state; }
    };
})();
