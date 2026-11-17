'use strict';

/*
    Рабочее место системы ВПВ: форма слева, схема стояков в центре,
    расчёт и приложение справа.

    Всё перерисовывается после каждой правки; фокус возвращается в то же поле
    по ключу data-key, правка применяется на следующем такте — как в панелях
    АПТ, чтобы Tab переводил в соседнее поле, а не терял фокус.
*/

var VpvUI = (function () {

    var tab = 'calc';
    var zoom = 1;
    var last = null;

    function $(id) { return document.getElementById(id); }
    function esc(t) { return Fmt.html(t); }
    function n2(v) { return Fmt.num(v, 2); }

    function sys() {
        var s = App.system();
        return s && s.kind === 'vpv' ? s : null;
    }

    function valueText(v) {
        if (v === null || v === undefined || v === '') return '';
        if (typeof v !== 'number') return String(v);
        return Fmt.trim(v, 3);
    }

    /** Номер приложения — общий счёт книги; в самопроверке книги нет. */
    function appendixNo(s) {
        return typeof App !== 'undefined' && App.book ? Appendix.of(App.book, 'vpv:' + s.id) : '';
    }

    function numField(label, key, value, unit, placeholder) {
        return '<label class="field"><span>' + esc(label) + (unit ? ', ' + esc(unit) : '') + '</span>'
            + '<input type="text" inputmode="decimal" data-key="' + key + '" value="' + esc(valueText(value)) + '"'
            + (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + '></label>';
    }

    function textField(label, key, value) {
        return '<label class="field"><span>' + esc(label) + '</span><input type="text" data-key="' + key + '" value="' + esc(value) + '"></label>';
    }

    function selectField(label, key, value, options) {
        return '<label class="field"><span>' + esc(label) + '</span><select data-key="' + key + '">'
            + options.map(function (o) {
                return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
            }).join('') + '</select></label>';
    }

    function checkField(label, key, checked) {
        return '<label class="check"><input type="checkbox" data-key="' + key + '"' + (checked ? ' checked' : '') + '> ' + esc(label) + '</label>';
    }

    /** Число струй галочками 1…6; выбрана всегда одна. */
    function jetChoice(label, key, value) {
        var chips = [1, 2, 3, 4, 5, 6].map(function (n) {
            var on = n === value;
            return '<label class="chip' + (on ? ' on' : '') + '"><input type="checkbox" data-key="' + key + '" data-value="' + n + '"'
                + (on ? ' checked' : '') + '>' + n + '</label>';
        }).join('');
        return '<div class="jet-row"><span>' + esc(label) + '</span><div class="chips">' + chips + '</div></div>';
    }

    function jetWord(n) {
        var d = n % 10;
        var h = n % 100;
        if (d === 1 && h !== 11) return 'струю';
        if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return 'струи';
        return 'струй';
    }

    function flowHint(v, res) {
        var pk = v.pk;
        if (!(res.q1 > 0)) return '';
        if (pk.growth) {
            return 'Нижние ПК стоят под бо́льшим напором и дают больше воды: q = k·√P, k = q₁/√Hпр. Расходы струй — в таблице справа.';
        }
        return 'Расход условный: стояк ' + pk.jets + ' × ' + n2(res.q1) + ' = ' + n2(pk.jets * res.q1) + ' л/с, магистраль '
            + pk.mainJets + ' × ' + n2(res.q1) + ' = ' + n2(pk.mainJets * res.q1) + ' л/с.';
    }

    /** Итоги потерь под таблицей участков: по длине, местные, по участкам, с насосной и вводом. */
    function totalRows(v, d, span, numCls) {
        var i = v.inlet;
        var td = numCls ? '<td class="num">' : '<td>';
        function row(label, value, strong) {
            return '<tr class="total-row"><td colspan="' + span + '">' + (strong ? '<b>' + esc(label) + '</b>' : esc(label)) + '</td>'
                + td + (strong ? '<b>' + Fmt.num(value, 3) + '</b>' : Fmt.num(value, 3)) + '</td></tr>';
        }
        return row('Итого по длине ΣНl = подводка ' + Fmt.num(d.friction.branch, 3) + ' + стояк ' + Fmt.num(d.friction.riser, 3)
                + ' + магистраль ' + Fmt.num(d.friction.main, 3), d.sumL, true)
            + row('Местные ΣНм = ΣНl · ' + Fmt.trim(i.localFactor, 3), d.Hm)
            + row('Итого по всем участкам ΣНl + ΣНм', d.sumL + d.Hm, true)
            + row('Потери в насосной установке ННС', i.stationLoss)
            + row('Потери на вводе Нв', i.inletLoss)
            + row('Итого потери ΣНl,tot', d.HlTot, true);
    }

    function pipeText(p) {
        return (p.dn ? 'Ду' + p.dn + ' ' : '') + String(p.od).replace('.', ',') + '×' + String(p.wall).replace('.', ',');
    }

    function section(title, body, cls) {
        return '<fieldset class="section ' + (cls || '') + '"><legend>' + esc(title) + '</legend>' + body + '</fieldset>';
    }

    function pipeFields(label, key, pipe) {
        var materials = Catalog.MATERIALS.map(function (m) { return [m.key, m.key]; });
        var sizes = Catalog.sizes(pipe.material).map(function (r) {
            return [r.od + '|' + r.wall, 'Ду' + r.dn + '  ' + String(r.od).replace('.', ',') + '×' + String(r.wall).replace('.', ',')];
        });
        if (!sizes.some(function (s) { return s[0] === pipe.od + '|' + pipe.wall; })) {
            sizes.push([pipe.od + '|' + pipe.wall, pipe.od + '×' + pipe.wall + ' — нет в таблице']);
        }
        return '<div class="pair">' + selectField(label + ': материал', key + '.material', pipe.material, materials)
            + selectField('размер', key + '.size', pipe.od + '|' + pipe.wall, sizes) + '</div>';
    }

    function rerender(container, html) {
        var active = document.activeElement;
        var key = active && container.contains(active) && active.dataset ? active.dataset.key : null;
        var scroll = container.scrollTop;
        container.innerHTML = html;
        container.scrollTop = scroll;
        if (key) {
            var el = container.querySelector('[data-key="' + key.replace(/"/g, '\\"') + '"]');
            if (el) el.focus({ preventScroll: true });
        }
    }

    /* --- форма ------------------------------------------------------------ */

    function renderForm(s, v, res) {
        var pk = v.pk;
        var t = res.table || { found: false };

        var html = section('Система',
            '<div class="pair">' + textField('Обозначение', 'sys:code', s.code) + textField('Зона', 'v:zone', v.zone) + '</div>'
            + textField('Часть здания', 'v:purpose', v.purpose)
            + textField('Наименование системы', 'sys:title', s.title)
            + checkField('воздухозаполненная (гл. 8 СП 10)', 'v:airFilled', v.airFilled)
            + '<p class="hint">Приложение <b>' + (appendixNo(s) || '—')
            + '</b> — номер раздаётся сам, подряд по книге: каталожные листы насосных установок и жокеев, '
            + 'затем расчёты. Первый номер и перечень — во вкладке «Текстовая часть».</p>');

        html += section('Пожарный кран — СП 10.13130 табл. 7.3',
            '<div class="pair">' + selectField('DN клапана', 'v:pk.dn', pk.dn, [[50, 'DN 50'], [65, 'DN 65']])
            + selectField('Спрыск ствола', 'v:pk.nozzle', pk.nozzle, [[13, '13 мм'], [16, '16 мм'], [19, '19 мм']]) + '</div>'
            + '<div class="pair">' + selectField('Длина рукава', 'v:pk.hose', pk.hose, [[10, '10 м'], [15, '15 м'], [20, '20 м']])
            + selectField('Компактная струя', 'v:pk.compact', pk.compact, [6, 8, 10, 12, 14, 16, 18, 20].map(function (h) { return [h, h + ' м']; })) + '</div>'
            + '<p class="hint">' + (t.found
                ? 'По табл. 7.3: q = ' + Fmt.trim(t.q, 2) + ' л/с, P = ' + Fmt.trim(t.p / 100, 3) + ' МПа (' + Fmt.trim(t.p, 2) + ' м).'
                : 'Такого сочетания в табл. 7.3 нет — впишите q и P вручную.')
            + ' Компактная струя по п. 7.15: 6 м до 50 м высоты, 8 м — жилые выше 50 м, 16 м — общественные выше 50 м.</p>'
            + jetChoice('Струй на стояке', 'v:pk.jets', pk.jets)
            + jetChoice('Струй на магистрали', 'v:pk.mainJets', pk.mainJets)
            + checkField('Учитывать рост расхода нижних ПК (п. 7.6)', 'v:pk.growth', pk.growth)
            + '<p class="hint">' + flowHint(v, res) + '</p>'
            + '<div class="pair">' + numField('ПК на этаже в стояке', 'v:pk.perFloor', pk.perFloor, 'шт')
            + numField('Мин. расход по табл. 7.1', 'v:pk.qMin', pk.qMin, 'л/с') + '</div>'
            + numField('Высота клапана над полом', 'v:pk.valveHeight', pk.valveHeight, 'м')
            + '<div class="pair">' + numField('Расход q (пусто — по таблице)', 'v:pk.q', pk.q, 'л/с', t.found ? Fmt.trim(t.q, 2) : '')
            + numField('Давление Hпр (пусто — по таблице)', 'v:pk.p', pk.p, 'м', t.found ? Fmt.trim(t.p, 2) : '') + '</div>');

        var rows = v.sections.map(function (sec) {
            function cell(field, value) {
                return '<td><input class="cell" data-key="sec:' + sec.id + ':' + field + '" value="' + esc(valueText(value)) + '"></td>';
            }
            return '<tr>'
                + '<td><input class="cell short-name" data-key="sec:' + sec.id + ':name" value="' + esc(sec.name) + '"></td>'
                + cell('floorsFrom', sec.floorsFrom) + cell('floorsTo', sec.floorsTo)
                + cell('firstElev', sec.firstElev) + cell('firstHeight', sec.firstHeight) + cell('floorHeight', sec.floorHeight)
                + cell('underHeight', sec.underHeight) + cell('mainLen', sec.mainLen)
                + '<td><button class="mini danger" data-action="sec-del:' + sec.id + '"' + (v.sections.length <= 1 ? ' disabled' : '') + '>×</button></td>'
                + '</tr>';
        }).join('');

        html += section('Секции и этажи зоны',
            '<div class="table-wrap"><table class="grid sections"><thead><tr><th>Секция</th><th>Этаж с</th><th>по</th><th>Отм. 1 эт.</th>'
            + '<th>h 1 эт.</th><th>h этажа</th><th>h подз.</th><th>L маг., м</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
            + '<div class="actions"><button data-action="sec-add">+ Секция</button></div>'
            + '<p class="hint">Подземные этажи — отрицательными номерами (−1, −2). L маг. — длина магистрали от насосной до стояка секции. '
            + 'Отметку отдельного этажа можно поправить ниже: этажи над ним поднимутся вслед за ним '
            + 'на типовую высоту, пока не встретится следующая вписанная отметка.</p>'
            + v.sections.map(function (sec) {
                var floors = Vpv.floorsOf(sec);
                return '<details class="floors"><summary>Отметки этажей ' + esc(sec.name) + ' (' + floors.length + ')</summary><div class="floor-grid">'
                    + floors.map(function (f) {
                        var own = sec.overrides && typeof sec.overrides[String(f.n)] === 'number';
                        var generatedValue = (function () { var copy = JSON.parse(JSON.stringify(sec)); delete copy.overrides[String(f.n)]; return Vpv.floorElev(copy, f.n); })();
                        return '<label class="field"><span>' + esc(f.label) + '</span><input type="text" class="' + (own ? 'manual' : '') + '" data-key="fl:' + sec.id + ':' + f.n
                            + '" value="' + (own ? esc(valueText(f.elev)) : '') + '" placeholder="' + esc(Fmt.num(generatedValue, 3)) + '"></label>';
                    }).join('') + '</div></details>';
            }).join(''));

        html += section('Ввод и насосная',
            '<div class="pair">' + numField('Гарантированный напор Нгар', 'v:inlet.guaranteed', v.inlet.guaranteed, 'м')
            + numField('Отметка оси ввода', 'v:inlet.elev', v.inlet.elev, 'м') + '</div>'
            + '<div class="pair">' + numField('Потери на вводе Нв', 'v:inlet.inletLoss', v.inlet.inletLoss, 'м')
            + numField('Потери в насосной ННС', 'v:inlet.stationLoss', v.inlet.stationLoss, 'м') + '</div>'
            + '<div class="pair">' + numField('Доля местных потерь', 'v:inlet.localFactor', v.inlet.localFactor, '')
            + numField('Напор насоса при нулевой подаче', 'v:inlet.pumpZero', v.inlet.pumpZero, 'м') + '</div>'
            + checkField('Насосная установка (иначе — от гарантированного напора)', 'v:inlet.pumps', v.inlet.pumps));

        html += section('Трубы — потери по Дарси–Вейсбаху',
            '<div class="pair">' + selectField('λ по формуле', 'v:hydr.formula', v.hydr.formula,
                [['shevelev', 'Шевелева — неновые стальные'], ['altshul', 'Альтшуля'], ['colebrook', 'Колбрука–Уайта']])
            + numField('Запас к диаметру на отложения', 'v:hydr.reserve', v.hydr.reserve, 'мм') + '</div>'
            + numField('Вязкость ν, ×10⁻⁶ м²/с', 'v:hydr.nu', v.hydr.nu, '')
            + '<p class="hint">h = λ·L/dр·V²/2g; V и Re = V·dр/ν — по расчётному диаметру dр = d − запас. '
            + (v.hydr.formula === 'shevelev'
                ? 'Шевелев (dр в м): λ = 0,021/dр^0,3 при V ≥ 1,2 м/с, λ = 0,0179/dр^0,3·(1 + 0,867/V)^0,3 при V < 1,2 м/с — '
                    + 'то же, что 1000i = 1,07·V²/dр^1,3. Шероховатость Δ здесь не нужна.'
                : 'Шероховатость Δ неновых стальных труб 0,5–1 мм, новых 0,05–0,1 мм.')
            + ' ν = 1,31 при 10 °C, 1,01 при 20 °C.</p>'
            + pipeFields('Подводка к ПК', 'v:branch', v.branch)
            + '<div class="pair">' + numField('Длина подводки', 'v:branch.len', v.branch.len, 'м')
            + numField('Шероховатость Δ', 'v:branch.rough', v.branch.rough, 'мм') + '</div>'
            + pipeFields('Стояк', 'v:riser', v.riser)
            + '<div class="pair">' + numField('Шероховатость Δ', 'v:riser.rough', v.riser.rough, 'мм') + '<div></div></div>'
            + pipeFields('Магистраль', 'v:main', v.main)
            + '<div class="pair">' + numField('Шероховатость Δ', 'v:main.rough', v.main.rough, 'мм')
            + numField('Отметка магистрали', 'v:baseElev', v.baseElev, 'м') + '</div>');

        var dia = v.dia;
        html += section('Диафрагмы',
            checkField('Подбирать диафрагмы', 'v:dia.on', dia.on)
            + (dia.on
                ? '<div class="pair">' + selectField('Срезаем', 'v:dia.mode', dia.mode,
                    [['fixed', 'до заданного давления'], ['excess', 'до требуемого Hпр']])
                    + (dia.mode === 'fixed'
                        ? numField('Срезать до', 'v:dia.target', dia.target, 'м')
                        : numField('Запас сверх Hпр', 'v:dia.margin', dia.margin, 'м')) + '</div>'
                + '<div class="pair">' + numField('Шаг диаметра', 'v:dia.step', dia.step, 'мм')
                + selectField('Округление', 'v:dia.round', dia.round,
                    [['down', 'срезать не меньше нужного'], ['up', 'не срезать лишнего']]) + '</div>'
                + numField('Наименьший диаметр', 'v:dia.minD', dia.minD, 'мм')
                + checkField('Подобрать общую шайбу на стояк', 'v:dia.riser', dia.riser)
                + checkField('Считать по напору общей насосной', 'v:dia.station', dia.station)
                + (res.station
                    ? '<p class="note-warn">Насосная «' + esc(res.station.name) + '»: напор ' + n2(res.station.H) + ' м'
                        + (res.station.by ? ' задаёт ' + esc(res.station.by) : '') + ', свой — ' + n2(res.pumpHead)
                        + ' м. Давления у ПК и диафрагмы посчитаны по напору насосной.</p>'
                    : '')
                + '<p class="hint">Шайба у ПК считается на расход, который кран даёт после среза: q = k·√P. Диаметр округляется вверх '
                + 'по шагу — меньший срез, но напор не ниже требуемого. Шайба на стояке срезает общий излишек всех ПК стояка и '
                + 'работает только при протоке: гидростатику в дежурном режиме она не снижает.</p>'
                : ''));

        html += section('Пределы',
            '<div class="pair">' + selectField('Гидростатика у нижнего ПК', 'v:limits.hydro', v.limits.hydro,
                [[90, '90 м (0,9 МПа, п. 6.2.20)'], [60, '60 м (по СТУ / заданию)'], [45, '45 м (совмещённый с ХПВ)']])
            + numField('Диафрагмы при давлении больше', 'v:limits.diaphragm', v.limits.diaphragm, 'м') + '</div>');

        rerender($('vpvForm'), html);
    }

    /* --- схема ------------------------------------------------------------ */

    function drawing(s, v, res) {
        if (!res.ok) return '<div class="empty">' + esc(res.errors.join(' ')) + '</div>';

        var px = 15 * zoom;
        var colW = 420 * zoom;
        // Слева колонка подписей этажей, за ней насосная, потом стояки.
        var boxX = 150;
        var boxW = 110;
        var left = boxX + boxW + 80 * zoom;
        var zs = [v.baseElev, v.inlet.elev];

        res.marches.forEach(function (m) { m.floors.forEach(function (f) { zs.push(f.z); }); });

        var zmax = Math.max.apply(null, zs) + 4;
        var zmin = Math.min.apply(null, zs) - 3;
        var width = left + res.marches.length * colW + 60;
        var height = (zmax - zmin) * px + 90;
        var font = Math.max(10, 11 * zoom);

        function Y(z) { return 50 + (zmax - z) * px; }
        function T(x, y, str, opts) {
            opts = opts || {};
            return '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" font-size="' + (opts.size || font) + '"'
                + (opts.anchor ? ' text-anchor="' + opts.anchor + '"' : '')
                + ' fill="' + (opts.color || '#1B2A38') + '"' + (opts.bold ? ' font-weight="700"' : '') + '>' + esc(str) + '</text>';
        }
        function L(x1, y1, x2, y2, color, w, dash) {
            return '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1)
                + '" stroke="' + color + '" stroke-width="' + (w || 1) + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>';
        }

        var red = '#D2413A';
        var out = [];
        var mainY = Y(v.baseElev);
        var inletY = Y(v.inlet.elev);

        out.push(T(16, 26, s.code + ' — ' + v.zone + (v.purpose ? ', ' + v.purpose : ''), { size: font + 3, bold: true, color: '#1D6FB8' }));

        // Ввод и насосная.
        var boxMid = boxX + boxW / 2;
        out.push(L(10, inletY, boxX, inletY, '#C2185B', 2.5));
        out.push(T(10, inletY - 6, 'Нгар = ' + n2(v.inlet.guaranteed) + ' м', { color: '#C2185B' }));
        out.push(T(10, inletY + 16, 'отм. ' + Fmt.num(v.inlet.elev, 3), { color: '#5B7186' }));
        out.push('<rect x="' + boxX + '" y="' + (Math.min(inletY, mainY) - 22).toFixed(1) + '" width="' + boxW + '" height="'
            + (Math.abs(inletY - mainY) + 44).toFixed(1) + '" fill="#FFF" stroke="#1B2A38" stroke-dasharray="5 3"/>');
        out.push(T(boxMid, Math.min(inletY, mainY) - 30, v.inlet.pumps ? 'Насосная установка' : 'Узел ввода', { anchor: 'middle', bold: true }));
        if (v.inlet.pumps) {
            out.push(T(boxMid, Math.max(inletY, mainY) + 40, 'Q = ' + n2(res.dict.Q) + ' л/с', { anchor: 'middle', color: red }));
            out.push(T(boxMid, Math.max(inletY, mainY) + 40 + font + 3, 'Нр = ' + n2(res.pumpHead) + ' м', { anchor: 'middle', color: red, bold: true }));
        }
        out.push(L(boxX + boxW, mainY, left + (res.marches.length - 1) * colW + 40, mainY, red, 3));

        res.marches.forEach(function (m, i) {
            var x = left + i * colW + 40;
            var isDict = m === res.dict;
            var topY = Y(m.zTop);
            var jetFloors = {};
            m.jets.forEach(function (j) { jetFloors[j.floor.n] = (jetFloors[j.floor.n] || []).concat([j]); });

            out.push(T(x, topY - 24, 'Секция ' + m.section.name + (isDict ? ' — диктующая' : ''), { anchor: 'middle', bold: true, color: isDict ? red : '#1B2A38' }));
            out.push(L(x, mainY, x, topY, red, isDict ? 3 : 2.2));
            out.push(T(x - 8, mainY + font + 6, 'L = ' + Fmt.trim(m.section.mainLen, 2) + ' м, Q = ' + n2(m.Q) + ' л/с',
                { anchor: 'end', color: '#5B7186' }));

            m.floors.forEach(function (f, k) {
                var y = Y(f.z);
                var floorY = Y(f.elev);
                var jets = jetFloors[f.n];
                var isTop = k === 0;

                out.push(L(i === 0 ? boxX + boxW + 6 : x - 90 * zoom, floorY, x + 170 * zoom, floorY, '#DCE7F2', 1, '4 3'));
                if (i === 0) {
                    out.push(T(8, floorY - 3, f.label + '  ' + (f.elev >= 0 ? '+' : '') + Fmt.num(f.elev, 3), { color: '#5B7186', size: font - 1 }));
                }

                out.push(L(x, y, x + 26 * zoom, y, red, 1.6));
                var cx = x + 34 * zoom;
                out.push('<circle cx="' + cx.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (6 * zoom).toFixed(1) + '" fill="' + (jets ? red : '#FFF') + '" stroke="' + red + '" stroke-width="1.6"/>');
                if (isDict && isTop) {
                    out.push('<circle cx="' + cx.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (10 * zoom).toFixed(1) + '" fill="none" stroke="#E8892B" stroke-width="2"/>');
                }
                if (f.diaphragm) {
                    out.push('<rect x="' + (cx + 9 * zoom).toFixed(1) + '" y="' + (y - 6 * zoom).toFixed(1) + '" width="' + (10 * zoom).toFixed(1) + '" height="' + (12 * zoom).toFixed(1) + '" fill="#FDF1E4" stroke="#E8892B"/>');
                }

                var label = 'P = ' + n2(f.P) + ' м';
                if (jets) label += '   q = ' + jets.map(function (j) { return n2(j.q); }).join(' + ') + ' л/с';
                if (f.dia && f.dia.ok) label += '   шайба ⌀' + Fmt.trim(f.dia.d, 1) + ' → ' + n2(f.after) + ' м';
                else if (f.diaphragm) label += '   диафрагма';
                out.push(T(cx + 24 * zoom, y + 4, label, { color: f.diaphragm ? '#B35F10' : jets ? red : '#1B2A38', bold: !!jets }));
            });

            // Расход по участкам стояка диктующей секции.
            if (isDict) {
                m.segments.forEach(function (seg) {
                    if (seg.kind !== 'riser') return;
                    var upper = m.floors.filter(function (f) { return seg.name.indexOf(f.label + ' —') === 0; })[0];
                    if (!upper) return;
                    var yMid = Y(upper.z) + seg.L * px / 2;
                    out.push(T(x - 8, yMid + 4, 'Q=' + n2(seg.Q) + ' ⌀' + (seg.pipe.dn || seg.pipe.od), { anchor: 'end', size: font - 1, color: '#1D6FB8' }));
                });
            }
        });

        return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width.toFixed(0) + '" height="' + height.toFixed(0) + '" viewBox="0 0 '
            + width.toFixed(0) + ' ' + height.toFixed(0) + '" font-family="Segoe UI, Arial, sans-serif">' + out.join('') + '</svg>';
    }

    /* --- справа: расчёт и вывод -------------------------------------------- */

    function card(title, value, note, cls) {
        return '<div class="card ' + (cls || '') + '"><div class="card-title">' + esc(title) + '</div><div class="card-value">'
            + esc(value) + '</div><div class="card-note">' + esc(note || '') + '</div></div>';
    }

    function warnings(list) {
        return list.length ? '<ul class="warnings">' + list.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '';
    }

    function groupName(kind) {
        return kind === 'branch' ? 'подводка' : kind === 'riser' ? 'стояк' : 'магистраль';
    }

    /** Подобранные шайбы: по одной на ПК и общая на стояк. */
    function diaphragmTable(v, res) {
        if (!v.dia.on || !res.dia) return '';

        var rows = [];
        res.marches.forEach(function (m) {
            if (m.riserDia) {
                rows.push('<tr class="selected"><td>' + esc(m.section.name) + '</td><td>стояк, у магистрали</td>'
                    + '<td class="num">' + n2(m.Q) + '</td><td class="num">' + n2(m.riserDia.need) + '</td>'
                    + '<td class="num">' + Fmt.num(m.riserDia.exact, 1) + '</td><td class="num"><b>' + Fmt.trim(m.riserDia.d, 1) + '</b></td>'
                    + '<td class="num">' + n2(m.riserDia.cut) + '</td><td class="dim">общая для стояка</td></tr>');
            }
            m.floors.forEach(function (f) {
                if (!f.dia || !f.dia.ok) return;
                rows.push('<tr><td>' + esc(m.section.name) + '</td><td>' + esc(f.label) + '</td>'
                    + '<td class="num">' + n2(f.dia.q) + '</td>'
                    + '<td class="num">' + n2(f.need) + '</td><td class="num">' + Fmt.num(f.dia.exact, 1) + '</td>'
                    + '<td class="num"><b>' + Fmt.trim(f.dia.d, 1) + '</b></td><td class="num">' + n2(f.dia.cut) + '</td>'
                    + '<td class="num">' + n2(f.after) + '</td></tr>');
            });
        });

        if (!rows.length) {
            return '<h4 class="pipes-title">Диафрагмы</h4><p class="hint">Срезать нечего: давление нигде не выше '
                + n2(res.dia.allowed) + ' м.</p>';
        }

        return '<h4 class="pipes-title">Диафрагмы — срез до ' + n2(res.dia.allowed) + ' м ('
            + Fmt.trim(res.dia.allowed / 100, 2) + ' МПа)</h4>'
            + '<table class="grid"><thead><tr><th>Секция</th><th>Где</th><th>Q, л/с</th><th>Срезать, м</th>'
            + '<th>⌀ расчётный, мм</th><th>⌀ принятый, мм</th><th>Срежет, м</th><th>Станет, м</th></tr></thead><tbody>'
            + rows.join('') + '</tbody></table>'
            + '<p class="hint">Диаметр округлён вверх по шагу ' + Fmt.trim(v.dia.step, 2) + ' мм, поэтому срез чуть меньше нужного, '
            + 'а давление у ПК остаётся не ниже требуемого. Шайба на стояке работает только при протоке.</p>';
    }

    function renderCalc(s, v, res) {
        var bar = '<div class="calc-bar"><div class="spacer"></div><button data-action="vpv-xlsx">Выгрузить .xlsx</button></div>';
        if (!res.ok) return bar + '<div class="empty">' + esc(res.errors.join(' ')) + '</div>';

        var d = res.dict;
        var html = bar + '<div class="cards small">'
            + card('Расход Q', n2(d.Q) + ' л/с', 'стояк ' + n2(d.Qriser) + ' л/с · ' + res.jetsText)
            + card('Нтр', n2(d.Htr) + ' м', 'секция ' + d.section.name + ', ' + d.topFloor.label)
            + card(v.inlet.pumps ? 'Нр насоса' : 'Нтр − Нгар', n2(d.Hp) + ' м', d.Hp > 0 ? '' : 'насос не нужен', d.Hp > 0 ? '' : 'ok')
            + card('Потери ΣНl,tot', n2(d.HlTot) + ' м', 'по длине ' + n2(d.sumL) + ' · местные ' + n2(d.Hm) + ' · насосная ' + n2(v.inlet.stationLoss) + ' · ввод ' + n2(v.inlet.inletLoss))
            + card('Гидростатика у нижнего ПК', n2(res.hydro.value) + ' м', 'предел ' + res.hydro.limit + ' м', res.hydro.ok ? 'ok' : 'bad')
            + '</div>'
            + (res.station
                ? '<p class="note-warn">Давления у ПК посчитаны по напору общей насосной «' + esc(res.station.name) + '» — '
                    + n2(res.station.H) + ' м' + (res.station.by ? ' (задаёт ' + esc(res.station.by) + ')' : '')
                    + ', свой требуемый напор системы ' + n2(res.pumpHead) + ' м.</p>'
                : '')
            + warnings(res.warnings);

        html += '<h4 class="pipes-title">Диктующее направление — секция ' + esc(d.section.name) + '</h4>'
            + '<p class="hint">Потери по Дарси–Вейсбаху, λ по формуле ' + esc(res.formulaName) + ', расчётный диаметр dр на '
            + Fmt.trim(v.hydr.reserve, 2) + ' мм меньше фактического, ν = ' + Fmt.trim(v.hydr.nu, 3) + '·10⁻⁶ м²/с. Стояк на ' + d.riserJets + ' ' + jetWord(d.riserJets) + ', магистраль на ' + d.mainJets + ' ' + jetWord(d.mainJets)
            + (v.pk.growth ? ', с ростом расхода нижних ПК.' : ', расход условный.') + '</p>'
            + '<table class="grid"><thead><tr><th>Участок</th><th>Группа</th><th>Q, л/с</th><th>Труба</th><th>dр, мм</th><th>L, м</th><th>Δ, мм</th>'
            + '<th>V, м/с</th><th>Re</th><th>λ</th><th>ΔH, м</th></tr></thead><tbody>'
            + d.segments.map(function (seg) {
                return '<tr><td>' + esc(seg.name) + '</td><td>' + groupName(seg.kind) + '</td><td class="num">' + n2(seg.Q) + '</td><td>'
                    + esc(pipeText(seg.pipe)) + '</td><td class="num">' + Fmt.trim(seg.pipe.dCalc, 2) + '</td><td class="num">' + n2(seg.L)
                    + '</td><td class="num">' + (v.hydr.formula === 'shevelev' ? '—' : Fmt.trim(seg.pipe.rough, 3))
                    + '</td><td class="num">' + n2(seg.V) + '</td><td class="num">' + Math.round(seg.Re) + '</td><td class="num">' + Fmt.num(seg.lambda, 4)
                    + '</td><td class="num">' + Fmt.num(seg.dH, 3) + '</td></tr>';
            }).join('')
            + totalRows(v, d, 10, true)
            + '</tbody></table>';

        html += '<h4 class="pipes-title">Одновременно работающие струи</h4><table class="grid"><thead><tr><th>ПК</th><th>Где</th><th>P у клапана, м</th><th>q, л/с</th></tr></thead><tbody>'
            + d.jets.map(function (j, i) {
                return '<tr><td>' + (i + 1) + (i === 0 ? ' — диктующий' : '') + '</td><td>стояк, ' + esc(j.floor.label) + '</td><td class="num">' + n2(j.P) + '</td><td class="num">' + n2(j.q) + '</td></tr>';
            }).join('')
            + d.mainExtra.map(function (j, i) {
                return '<tr><td>' + (d.jets.length + i + 1) + '</td><td>на магистраль (соседний стояк)</td><td class="num">' + n2(j.P) + '</td><td class="num">' + n2(j.q) + '</td></tr>';
            }).join('')
            + '<tr class="total-row"><td colspan="3">Стояк / магистраль</td><td class="num">' + n2(d.Qriser) + ' / ' + n2(d.Q) + '</td></tr>'
            + '</tbody></table>';

        html += diaphragmTable(v, res);

        html += '<h4 class="pipes-title">Давление у ПК при работе ' + (v.inlet.pumps ? 'насоса' : 'от ввода') + '</h4>'
            + '<table class="grid"><thead><tr><th>Секция</th><th>Этаж</th><th>Отметка</th><th>P у ПК, м</th><th>Диафрагма</th></tr></thead><tbody>'
            + res.marches.map(function (m) {
                return m.floors.map(function (f) {
                    return '<tr class="' + (f.diaphragm ? 'selected' : '') + '"><td>' + esc(m.section.name) + '</td><td>' + esc(f.label) + '</td><td class="num">'
                        + Fmt.num(f.elev, 3) + '</td><td class="num' + (f.diaphragm ? ' bad' : '') + '">' + n2(f.P) + '</td><td>'
                        + (f.diaphragm ? 'нужна, снизить на ' + n2(f.excess) + ' м' : '—') + '</td></tr>';
                }).join('');
            }).join('') + '</tbody></table>';

        return html;
    }

    function appendix(s, v, res) {
        if (!res.ok) return '<p class="empty">' + esc(res.errors.join(' ')) + '</p>';

        var d = res.dict;
        var i = v.inlet;
        var pk = v.pk;
        var lines = [];

        function add(text, cls) { lines.push('<p class="r-' + (cls || 'text') + '">' + esc(text) + '</p>'); }

        add('Приложение ' + appendixNo(s), 'appendix');
        add('Расчёт напоров', 'title');
        add(s.code + ' — ' + v.zone + (v.purpose ? ', ' + v.purpose : ''), 'title');
        add('Расчёт напоров производится по методике СП 10.13130.2020 и СП 30.13330.2020.');
        add('Расчёт выполнен от ввода водопровода в здание до диктующего пожарного крана: секция ' + d.section.name + ', '
            + d.topFloor.label + ', отм. ' + Fmt.num(d.topFloor.elev, 3) + '.');
        add('Требуемый напор насосной установки:', 'sub');
        add('Нр = Нgeom + ΣНl,tot + Hпр − Нгар, где', 'formula');
        add('Нgeom — геометрическая высота подачи воды от оси ввода до диктующего пожарного крана:');
        add('Нgeom = ' + Fmt.num(d.topFloor.elev, 3) + ' + ' + Fmt.num(pk.valveHeight, 2) + ' − (' + Fmt.num(i.elev, 3) + ') = ' + n2(d.Hgeom) + ' м;', 'formula');
        add('Hпр — напор перед пожарным краном по табл. 7.3 СП 10.13130.2020 (клапан DN ' + pk.dn + ', спрыск ' + pk.nozzle
            + ' мм, рукав ' + pk.hose + ' м, компактная струя ' + pk.compact + ' м): Hпр = ' + n2(res.P1) + ' м, q = ' + n2(res.q1) + ' л/с;', 'formula');
        add('Нгар — минимальный гарантированный напор на вводе в здание: Нгар = ' + n2(i.guaranteed) + ' м.', 'formula');
        add('ΣНl,tot = ΣНl + ΣНм + ННС + Нв, где:');
        add('ННС — потери напора в насосной установке: ННС = ' + n2(i.stationLoss) + ' м;', 'formula');
        add('Нв — потери напора на вводе: Нв = ' + n2(i.inletLoss) + ' м;', 'formula');
        var lambdaText = v.hydr.formula === 'shevelev'
            ? 'Ф. А. Шевелева для неновых стальных труб: при V ≥ 1,2 м/с λ = 0,021/dр^0,3, при V < 1,2 м/с λ = 0,0179/dр^0,3 · (1 + 0,867/V)^0,3'
            : res.formulaName + ' ' + (v.hydr.formula === 'colebrook' ? 'λ = 0,25 / lg²(Δ/(3,7dр) + 5,74/Re^0,9)' : 'λ = 0,11 · (Δ/dр + 68/Re)^0,25')
                + '; Δ — эквивалентная шероховатость: подводка ' + Fmt.trim(v.branch.rough, 3) + ' мм, стояк ' + Fmt.trim(v.riser.rough, 3)
                + ' мм, магистраль ' + Fmt.trim(v.main.rough, 3) + ' мм; Re = V·dр/ν, ν = ' + Fmt.trim(v.hydr.nu, 3) + '·10⁻⁶ м²/с';
        add('Потери напора по длине определены по формуле Дарси–Вейсбаха h = λ · L/dр · V²/(2g), где λ — коэффициент гидравлического трения по формуле '
            + lambdaText + '; dр — расчётный внутренний диаметр, принятый на ' + Fmt.trim(v.hydr.reserve, 2)
            + ' мм меньше фактического с учётом отложений в неновых трубах.');
        add('ΣНl = ΣНl подв + ΣНl ст + ΣНl маг = ' + n2(d.friction.branch) + ' + ' + n2(d.friction.riser) + ' + ' + n2(d.friction.main)
            + ' = ' + n2(d.sumL) + ' м — линейные потери: стояк на ' + d.riserJets + ' ' + jetWord(d.riserJets)
            + ', магистраль на ' + d.mainJets + ' ' + jetWord(d.mainJets) + ';', 'formula');
        add('ΣНм = ΣНl · ' + Fmt.trim(i.localFactor, 3) + ' = ' + n2(d.sumL) + ' · ' + Fmt.trim(i.localFactor, 3) + ' = ' + n2(d.Hm) + ' м;', 'formula');
        add('ΣНl,tot = ' + n2(d.sumL) + ' + ' + n2(d.Hm) + ' + ' + n2(i.stationLoss) + ' + ' + n2(i.inletLoss) + ' = ' + n2(d.HlTot) + ' м.', 'formula');
        add('Требуемый напор в сети противопожарного водопровода:', 'sub');
        add('Нтр = ' + n2(d.Hgeom) + ' + ' + n2(d.HlTot) + ' + ' + n2(res.P1) + ' = ' + n2(d.Htr) + ' м.', 'result');
        add('Требуемый напор насосной установки:', 'sub');
        add('Нр = Нтр − Нгар = ' + n2(d.Htr) + ' − ' + n2(i.guaranteed) + ' = ' + n2(d.Hp) + ' м.', 'result');
        if (d.Hp <= 0) add('Гарантированного напора достаточно: насосная установка не требуется.');
        var riserFlow = v.pk.growth && d.jets.length > 1
            ? d.jets.map(function (j) { return n2(j.q); }).join(' + ')
            : d.jets.length + ' × ' + n2(res.q1);
        var mainFlow = Math.abs(d.Q - d.Qriser) < 1e-9 ? 'тот же расход'
            : !v.pk.growth && !d.jetsMissing ? 'Q = ' + d.mainJets + ' × ' + n2(res.q1) + ' = ' + n2(d.Q) + ' л/с'
            : d.mainExtra.length ? 'Q = ' + n2(d.Qriser) + ' + ' + d.mainExtra.length + ' × ' + n2(res.q1) + ' = ' + n2(d.Q) + ' л/с'
            : 'Q = ' + n2(d.Q) + ' л/с';
        add('Расчётный расход' + (v.pk.growth ? ' с учётом роста расхода нижних ПК (п. 7.6 СП 10.13130.2020)' : '')
            + ': на стояке Q = ' + riserFlow + ' = ' + n2(d.Qriser) + ' л/с; на магистрали ' + mainFlow + ' (' + res.jetsText + ').', 'result');
        add('Гидростатическое давление у наиболее низко расположенного ПК (' + res.hydro.floor.label + '): ' + n2(res.hydro.value)
            + ' м' + (res.hydro.ok ? ' — не более ' : ' — БОЛЬШЕ ') + res.hydro.limit + ' м.');

        var diaph = [];
        res.marches.forEach(function (m) { m.floors.forEach(function (f) { if (f.diaphragm) diaph.push(m.section.name + ' ' + f.label); }); });
        if (diaph.length) add('Давление у ПК более ' + Fmt.trim(v.limits.diaphragm / 100, 2) + ' МПа — диафрагмы между клапаном и головкой (СП 10.13130 п. 7.5): ' + diaph.join(', ') + '.');

        var table = '<table class="report-table"><thead><tr><th>Участок</th><th>Q, л/с</th><th>Ду</th><th>Dн×s, мм</th><th>dр, мм</th><th>L, м</th>'
            + '<th>V, м/с</th><th>Re</th><th>λ</th><th>ΔH, м</th></tr></thead><tbody>'
            + d.segments.map(function (seg) {
                return '<tr><td>' + esc(seg.name) + '</td><td>' + n2(seg.Q) + '</td><td>' + (seg.pipe.dn || '—') + '</td><td>' + esc(seg.pipe.od + '×' + seg.pipe.wall)
                    + '</td><td>' + Fmt.trim(seg.pipe.dCalc, 2) + '</td><td>' + n2(seg.L) + '</td><td>' + n2(seg.V) + '</td><td>' + Math.round(seg.Re)
                    + '</td><td>' + Fmt.num(seg.lambda, 4) + '</td><td>' + Fmt.num(seg.dH, 3) + '</td></tr>';
            }).join('') + totalRows(v, d, 9, false) + '</tbody></table>';

        return lines.join('') + table;
    }

    function renderOutput(s, v, res) {
        return '<div class="calc-bar"><button data-action="vpv-print" class="primary">Печать / PDF</button>'
            + '<button data-action="vpv-xlsx">Выгрузить .xlsx</button></div>'
            + '<div class="report">' + appendix(s, v, res) + '</div>';
    }

    /* --- Excel ------------------------------------------------------------ */

    function F(f, v, st) { return { f: f, v: v, s: st || 'num2' }; }
    function V(v, st) { return { v: v, s: st }; }

    function excelSheets(s, v, res) {
        var d = res.dict;
        var i = v.inlet;
        var IN = "'Исходные данные'!";

        var input = [
            [V('Исходные данные ВПВ ' + s.code + ' — зелёные ячейки можно менять', 'title')],
            ['Параметр', 'Значение', 'Ед.'].map(function (t) { return V(t, 'head'); }),
            [V('Отметка диктующего ПК (этаж + клапан)', 'text'), V(d.zTop, 'input'), V('м', 'text')],
            [V('Отметка оси ввода', 'text'), V(i.elev, 'input'), V('м', 'text')],
            [V('Напор у ПК Hпр (табл. 7.3)', 'text'), V(res.P1, 'input'), V('м', 'text')],
            [V('Гарантированный напор Нгар', 'text'), V(i.guaranteed, 'input'), V('м', 'text')],
            [V('Потери в насосной ННС', 'text'), V(i.stationLoss, 'input'), V('м', 'text')],
            [V('Потери на вводе Нв', 'text'), V(i.inletLoss, 'input'), V('м', 'text')],
            [V('Доля местных потерь', 'text'), V(i.localFactor, 'input'), V('', 'text')],
            [V('Кинематическая вязкость воды ν', 'text'), V(v.hydr.nu, 'input'), V('×10⁻⁶ м²/с', 'text')],
            [V('Запас к диаметру на отложения (dр = d − запас)', 'text'), V(v.hydr.reserve, 'input'), V('мм', 'text')]
        ];

        var calc = [
            [V('Диктующее направление — секция ' + d.section.name + '. Дарси–Вейсбах, λ по формуле ' + res.formulaName, 'title')],
            ['Участок', 'Группа', 'Q, л/с', 'Ду', 'Dнар, мм', 'Стенка, мм', 'L, м', 'Δ, мм', 'V, м/с', 'Re', 'λ', 'ΔH, м'].map(function (t) { return V(t, 'head'); })
        ];
        d.segments.forEach(function (seg) {
            var r = calc.length + 1;
            var dIn = '(E' + r + '-2*F' + r + '-' + IN + '$B$11)';
            var lambda = v.hydr.formula === 'colebrook'
                ? '0.25/LOG10(H' + r + '/(3.7*' + dIn + ')+5.74/J' + r + '^0.9)^2'
                : v.hydr.formula === 'shevelev'
                ? 'IF(I' + r + '>=1.2,0.021/(' + dIn + '/1000)^0.3,0.0179/(' + dIn + '/1000)^0.3*(1+0.867/I' + r + ')^0.3)'
                : '0.11*(H' + r + '/' + dIn + '+68/J' + r + ')^0.25';
            calc.push([V(seg.name, 'text'), V(groupName(seg.kind), 'text'), V(seg.Q, 'input'), V(seg.pipe.dn || '', 'num'), V(seg.pipe.od, 'num'),
                V(seg.pipe.wall, 'num'), V(seg.L, 'num2'), V(seg.pipe.rough, 'input'),
                F('4*C' + r + '/1000/(PI()*(' + dIn + '/1000)^2)', seg.V),
                F('I' + r + '*' + dIn + '/1000/(' + IN + '$B$10/1000000)', seg.Re, 'num'),
                F(lambda, seg.lambda, 'num3'),
                F('K' + r + '*G' + r + '/(' + dIn + '/1000)*I' + r + '^2/(2*9.81)', seg.dH, 'num3')]);
        });

        // Итоги под участками; группа «итого» не попадает в SUMIF листа «Вывод данных».
        var last = calc.length;
        function total(name, formula, value) {
            var line = [V(name, 'text'), V('итого', 'text')];
            for (var k = 0; k < 9; k++) line.push(V('', 'text'));
            line.push(F(formula, value, 'totalNum2'));
            calc.push(line);
            return calc.length;
        }
        var tL = total('Итого по длине ΣНl', 'SUM(L3:L' + last + ')', d.sumL);
        var tM = total('Местные ΣНм = ΣНl · доля', 'L' + tL + '*' + IN + '$B$9', d.Hm);
        total('Итого по всем участкам ΣНl + ΣНм', 'L' + tL + '+L' + tM, d.sumL + d.Hm);
        total('Итого с насосной и вводом ΣНl,tot', 'L' + tL + '+L' + tM + '+' + IN + '$B$7+' + IN + '$B$8', d.HlTot);

        var C = "'Расчет'!";
        var out = [
            [V('Приложение ' + appendixNo(s) + '. Расчёт напоров ' + s.code, 'title')],
            ['Величина', 'Формула', 'Значение, м'].map(function (t) { return V(t, 'head'); })
        ];
        function put(name, formula, cell) { out.push([V(name, 'text'), V(formula, 'text'), cell]); return out.length; }
        var rGeom = put('Нgeom', 'отм. ПК − отм. ввода', F(IN + '$B$3-' + IN + '$B$4', d.Hgeom));
        var rB = put('ΣНl подв', 'сумма ΔH подводки', F('SUMIF(' + C + '$B:$B,"подводка",' + C + '$L:$L)', d.friction.branch));
        var rR = put('ΣНl ст', 'сумма ΔH стояка', F('SUMIF(' + C + '$B:$B,"стояк",' + C + '$L:$L)', d.friction.riser));
        var rM = put('ΣНl маг', 'сумма ΔH магистрали', F('SUMIF(' + C + '$B:$B,"магистраль",' + C + '$L:$L)', d.friction.main));
        var rL = put('ΣНl', 'подв + ст + маг', F('C' + rB + '+C' + rR + '+C' + rM, d.sumL));
        var rHm = put('ΣНм', 'ΣНl × доля', F('C' + rL + '*' + IN + '$B$9', d.Hm));
        var rSt = put('ННС', 'потери в насосной установке', F(IN + '$B$7', i.stationLoss));
        var rIn = put('Нв', 'потери на вводе', F(IN + '$B$8', i.inletLoss));
        var rTot = put('ΣНl,tot', 'ΣНl + ΣНм + ННС + Нв', F('C' + rL + '+C' + rHm + '+C' + rSt + '+C' + rIn, d.HlTot));
        var rTr = put('Нтр', 'Нgeom + ΣНl,tot + Hпр', F('C' + rGeom + '+C' + rTot + '+' + IN + '$B$5', d.Htr, 'totalNum2'));
        put('Нр', 'Нтр − Нгар', F('C' + rTr + '-' + IN + '$B$6', d.Hp, 'totalNum2'));

        return [
            { name: 'Исходные данные', grid: input, widths: [42, 14, 8] },
            { name: 'Расчет', grid: calc, widths: [34, 12, 10, 7, 10, 10, 9, 8, 10, 11, 9, 10] },
            { name: 'Вывод данных', grid: out, widths: [16, 28, 14] }
        ];
    }

    /* --- обновление и события ---------------------------------------------- */

    function renderTabs() {
        $('vpvTabs').innerHTML = [['calc', 'Расчёт'], ['output', 'Вывод']].map(function (t) {
            return '<button data-tab="' + t[0] + '"' + (t[0] === tab ? ' class="active"' : '') + '>' + t[1] + '</button>';
        }).join('');
    }

    function updateTop(res) {
        var summary = $('summary');
        if (!res.ok) {
            summary.innerHTML = '<span class="dim">' + esc(res.errors.join(' ')) + '</span>';
            return;
        }
        var count = res.warnings.length;
        summary.innerHTML = '<span>Q <b>' + n2(res.dict.Q) + '</b> л/с</span><span>Нтр <b>' + n2(res.dict.Htr) + '</b> м</span>'
            + '<span>Нр <b>' + n2(res.dict.Hp) + '</b> м</span>'
            + (count ? '<span class="warn" title="' + esc(res.warnings.join('\n')) + '">замечаний: ' + count + '</span>' : '');
    }

    function refresh() {
        var s = sys();
        if (!s) return;

        var v = s.vpv;
        var res = Vpv.solve(v, App.book);
        last = res;

        renderForm(s, v, res);
        $('vpvCanvas').innerHTML = drawing(s, v, res);
        renderTabs();
        rerender($('vpvBody'), tab === 'output' ? renderOutput(s, v, res) : renderCalc(s, v, res));
        updateTop(res);
    }

    function applyValue(v, path, value) {
        var parts = path.split('.');
        var target = v;
        for (var i = 0; i < parts.length - 1; i++) target = target[parts[i]];
        var key = parts[parts.length - 1];

        if (typeof value === 'boolean') {
            target[key] = value;
            return;
        }

        if (key === 'size') {
            var ow = String(value).split('|');
            target.od = Number(ow[0]);
            target.wall = Number(ow[1]);
            return;
        }

        if (key === 'material') {
            var list = Catalog.sizes(value);
            var old = Catalog.find(target.material, target.od, target.wall);
            var best = list.filter(function (r) { return old && r.dn === old.dn; })[0] || list[0];
            target.material = value;
            if (best) {
                target.od = best.od;
                target.wall = best.wall;
            }
            return;
        }

        if (['zone', 'purpose', 'formula', 'mode', 'round'].indexOf(key) >= 0) {
            target[key] = String(value);
            return;
        }

        var num = Fmt.parse(value);
        if (['q', 'p', 'pumpZero'].indexOf(key) >= 0) {
            target[key] = num > 0 ? num : null;
            return;
        }
        if (num === null) return;
        if (['jets', 'mainJets', 'perFloor'].indexOf(key) >= 0) num = Math.max(1, Math.round(num));
        if (key === 'nu' && !(num > 0)) return;
        if ((key === 'rough' || key === 'reserve') && num < 0) return;
        target[key] = num;
    }

    function onChange(e) {
        var el = e.target;
        var key = el.dataset ? el.dataset.key : null;
        if (!key) return;

        // Галочки числа струй несут своё число; снять выбранную нельзя — останется она же.
        var value = el.type === 'checkbox' ? (el.dataset.value ? el.dataset.value : el.checked) : el.value;
        var parts = key.split(':');

        setTimeout(function () {
            var s = sys();
            if (!s) return;
            var v = s.vpv;

            if (parts[0] === 'v') {
                applyValue(v, parts[1], value);
            } else if (parts[0] === 'sys') {
                s[parts[1]] = String(value).trim();
            } else if (parts[0] === 'sec') {
                var sec = v.sections.filter(function (x) { return String(x.id) === parts[1]; })[0];
                if (!sec) return;
                if (parts[2] === 'name') sec.name = String(value).trim() || sec.name;
                else {
                    var num = Fmt.parse(value);
                    if (num === null) return;
                    if (parts[2] === 'floorsFrom' || parts[2] === 'floorsTo') num = Math.round(num);
                    sec[parts[2]] = num;
                }
            } else if (parts[0] === 'fl') {
                var sc = v.sections.filter(function (x) { return String(x.id) === parts[1]; })[0];
                if (!sc) return;
                var elev = Fmt.parse(value);
                if (elev === null) delete sc.overrides[parts[2]];
                else sc.overrides[parts[2]] = elev;
            }

            App.afterEdit('ВПВ ' + s.code);
        }, 0);
    }

    function onClick(e) {
        var b = e.target.closest('[data-action]');
        if (!b) return;

        var s = sys();
        if (!s) return;
        var parts = b.dataset.action.split(':');

        switch (parts[0]) {
            case 'sec-add':
                Vpv.addSection(s.vpv);
                App.afterEdit('секция ВПВ');
                break;
            case 'sec-del':
                if (s.vpv.sections.length > 1) {
                    s.vpv.sections = s.vpv.sections.filter(function (x) { return String(x.id) !== parts[1]; });
                    App.afterEdit('удаление секции');
                }
                break;
            case 'vpv-xlsx':
                if (last && last.ok) Xlsx.save(excelSheets(s, s.vpv, last), Systems.fileBase(App.book, s) + ' — ВПВ.xlsx');
                break;
            case 'vpv-print':
                $('printArea').innerHTML = '<div class="report">' + appendix(s, s.vpv, last) + '</div>';
                App.print();
                break;
        }
    }

    function init() {
        [$('vpvForm'), $('vpvBody')].forEach(function (el) {
            el.addEventListener('change', onChange);
            el.addEventListener('click', onClick);
        });

        $('vpvTabs').addEventListener('click', function (e) {
            var b = e.target.closest('button[data-tab]');
            if (!b) return;
            tab = b.dataset.tab;
            refresh();
        });

        $('vpvZoomIn').addEventListener('click', function () { zoom = Math.min(3, zoom * 1.25); refresh(); });
        $('vpvZoomOut').addEventListener('click', function () { zoom = Math.max(0.4, zoom / 1.25); refresh(); });
    }

    return {
        init: init,
        refresh: refresh,
        excelSheets: excelSheets,
        appendix: appendix,
        last: function () { return last; }
    };
})();
