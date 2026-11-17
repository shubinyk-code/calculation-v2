'use strict';

/*
    Рабочее место «АПТ по этажам»: форма слева, схема стояка в центре, расчёт
    и приложение справа. Интерфейс повторяет ВПВ — секции, этажи, отметки, —
    но система своя и от ВПВ не зависит.

    На схеме у каждого этажа с планом — отросток от стояка. Щелчок по отростку
    (или кнопка «План…» в списке планов) открывает план этажа в обычном
    редакторе АПТ; кнопка «← Стояк» возвращает сюда.

    Вид схемы: плоская — отростки вбок, как на принципиальной схеме;
    изометрия — сеть этажа из плана рисуется в аксонометрии на своей отметке.
*/

var FloorsUI = (function () {

    var tab = 'calc';
    var zoom = 1;
    var last = null;

    function $(id) { return document.getElementById(id); }
    function esc(t) { return Fmt.html(t); }
    function n2(v) { return Fmt.num(v, 2); }

    function sys() {
        var s = App.system();
        return s && s.kind === 'floors' ? s : null;
    }

    function valueText(v) {
        if (v === null || v === undefined || v === '') return '';
        if (typeof v !== 'number') return String(v);
        return Fmt.trim(v, 3);
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

    function section(title, body) {
        return '<fieldset class="section"><legend>' + esc(title) + '</legend>' + body + '</fieldset>';
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

    function sprinklerCount(project) {
        return project.nodes.filter(function (n) { return n.spr; }).length;
    }

    /* --- форма ------------------------------------------------------------------ */

    function renderForm(s, v, res) {
        var book = App.book;

        // Тип установки хранится в планах (там расчёт), а задаётся на систему.
        var first = v.plans[0] ? v.plans[0].project.settings : Model.defaults();
        var air = first.systemKind === 'воздухозаполненная';

        var html = section('Система',
            '<div class="pair">' + textField('Обозначение', 'sys:code', s.code) + textField('Зона', 'v:zone', v.zone) + '</div>'
            + textField('Часть здания', 'v:purpose', v.purpose)
            + textField('Наименование системы', 'sys:title', s.title)
            + selectField('Тип спринклерной установки (СП 485 п. 6.2.1)', 'kind:systemKind', first.systemKind,
                [['водозаполненная', 'водозаполненная'], ['воздухозаполненная', 'воздухозаполненная']])
            + (air ? checkField('Температура в помещении ниже 5 °C — оросители только вверх или горизонтально (п. 6.2.19)',
                'cold:coldRoom', first.coldRoom) : '')
            + '<p class="hint">Тип ставится сразу всем планам этажей этой системы — из него записка берёт строку '
            + '«водозаполненная / воздухозаполненная» в таблице оборудования АПТ.</p>');

        var sectionOptions = [['all', 'все секции']].concat(v.sections.map(function (sec) { return [String(sec.id), sec.name]; }));

        var planRows = v.plans.map(function (p) {
            var ps = res.plans[p.id];
            var used = res.floors.filter(function (r) { return r.plan === p; }).length;
            function cell(field, value) {
                return '<td><input class="cell" data-key="pl:' + p.id + ':' + field + '" value="' + esc(valueText(value)) + '"></td>';
            }
            return '<tr' + (res.dict && res.dict.plan === p ? ' class="selected"' : '') + '>'
                + '<td><input class="cell plan-name" data-key="pl:' + p.id + ':name" value="' + esc(p.name) + '"></td>'
                + '<td><select data-key="pl:' + p.id + ':section">' + sectionOptions.map(function (o) {
                    return '<option value="' + esc(o[0]) + '"' + (String(p.section) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
                }).join('') + '</select></td>'
                + cell('floorsFrom', p.floorsFrom) + cell('floorsTo', p.floorsTo)
                + '<td class="num">' + (ps && ps.ok ? n2(ps.Q) : '<span class="bad" title="' + esc(ps ? ps.errors.join(' ') : '') + '">—</span>') + '</td>'
                + '<td class="num">' + used + '</td>'
                + '<td class="plan-actions"><button class="primary mini" data-action="open-plan:' + p.id + '">План…</button>'
                + '<button class="mini" data-action="plan-dup:' + p.id + '">Копия</button>'
                + '<button class="mini danger" data-action="plan-del:' + p.id + '"' + (v.plans.length <= 1 ? ' disabled' : '') + '>×</button></td>'
                + '</tr>';
        }).join('');

        html += section('Планы этажей',
            '<div class="table-wrap"><table class="grid plans"><thead><tr><th>План</th><th>Секция</th><th>с</th><th>по</th>'
            + '<th>Q, л/с</th><th>этажей</th><th></th></tr></thead><tbody>' + planRows + '</tbody></table></div>'
            + '<div class="actions"><button data-action="plan-add">+ План этажа</button></div>'
            + '<p class="hint">Типовой план — на диапазон этажей; нетиповой (1-й, технический) — отдельным планом с узким диапазоном, '
            + 'он перекрывает типовой. На плане точка «Ввод» — врезка в стояк. Этаж без плана остаётся без АПТ.</p>');

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

        html += section('Секции и этажи',
            '<div class="table-wrap"><table class="grid sections"><thead><tr><th>Секция</th><th>Этаж с</th><th>по</th><th>Отм. 1 эт.</th>'
            + '<th>h 1 эт.</th><th>h этажа</th><th>h подз.</th><th>L маг., м</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
            + '<div class="actions"><button data-action="sec-add">+ Секция</button></div>'
            + '<p class="hint">Как в ВПВ: подземные этажи — отрицательными номерами, L маг. — от насосной до стояка секции. '
            + 'Вписанная отметка этажа поднимает за собой все этажи над ним — до следующей вписанной.</p>'
            + v.sections.map(function (sec) {
                var floors = Vpv.floorsOf(sec);
                return '<details class="floors"><summary>Отметки этажей ' + esc(sec.name) + ' (' + floors.length + ')</summary><div class="floor-grid">'
                    + floors.map(function (f) {
                        var own = sec.overrides && typeof sec.overrides[String(f.n)] === 'number';
                        var copy = JSON.parse(JSON.stringify(sec));
                        delete copy.overrides[String(f.n)];
                        return '<label class="field"><span>' + esc(f.label) + '</span><input type="text" class="' + (own ? 'manual' : '') + '" data-key="fl:' + sec.id + ':' + f.n
                            + '" value="' + (own ? esc(valueText(f.elev)) : '') + '" placeholder="' + esc(Fmt.num(Vpv.floorElev(copy, f.n), 3)) + '"></label>';
                    }).join('') + '</div></details>';
            }).join(''));

        html += section('Стояк и оросители',
            '<div class="pair">' + numField('Оросители над полом этажа', 'v:sprinklerHeight', v.sprinklerHeight, 'м')
            + numField('Потери в поэтажном узле', 'v:floorNodeLoss', v.floorNodeLoss, 'м') + '</div>'
            + '<p class="hint">Поэтажный узел — задвижка и сигнализатор потока жидкости на отводе от стояка.</p>'
            + pipeFields('Стояк', 'v:riser', v.riser)
            + pipeFields('Магистраль', 'v:main', v.main)
            + numField('Отметка магистрали (низ стояков)', 'v:baseElev', v.baseElev, 'м'));

        var units = Catalog.CONTROL_UNITS;
        var kinds = [];
        units.forEach(function (u) { if (kinds.indexOf(u.kind) < 0) kinds.push(u.kind); });
        var dns = units.filter(function (u) { return u.kind === v.inlet.cuKind; }).map(function (u) { return [u.dn, 'Ду' + u.dn]; });

        html += section('Ввод, насосная, узел управления',
            '<div class="pair">' + numField('Гарантированный напор Нгар', 'v:inlet.guaranteed', v.inlet.guaranteed, 'м')
            + numField('Отметка оси ввода', 'v:inlet.elev', v.inlet.elev, 'м') + '</div>'
            + '<div class="pair">' + numField('Потери в насосной Ннас', 'v:inlet.stationLoss', v.inlet.stationLoss, 'м')
            + numField('Коэффициент местных потерь', 'v:inlet.localFactor', v.inlet.localFactor, '') + '</div>'
            + numField('Потери на всасывании', 'v:inlet.suction', v.inlet.suction, 'м')
            + '<div class="pair">' + selectField('Узел управления', 'v:inlet.cuKind', v.inlet.cuKind, kinds.map(function (k) { return [k, k]; }))
            + selectField('Ду узла', 'v:inlet.cuDn', v.inlet.cuDn, dns.length ? dns : [[v.inlet.cuDn, 'Ду' + v.inlet.cuDn]]) + '</div>'
            + numField('ξ узла (пусто — по таблице)', 'v:inlet.cuXi', v.inlet.cuXi, '', res.xi > 0 ? String(res.xi) : ''));

        var dia = v.dia;
        html += section('Диафрагмы',
            checkField('Подбирать диафрагмы', 'v:dia.on', dia.on)
            + (dia.on
                ? '<div class="pair">' + selectField('Срезаем', 'v:dia.mode', dia.mode,
                    [['excess', 'до нужного сети этажа'], ['fixed', 'до заданного давления']])
                    + (dia.mode === 'fixed'
                        ? numField('Срезать до', 'v:dia.target', dia.target, 'м')
                        : numField('Запас сверх нужного', 'v:dia.margin', dia.margin, 'м')) + '</div>'
                + '<div class="pair">' + numField('Шаг диаметра', 'v:dia.step', dia.step, 'мм')
                + selectField('Округление', 'v:dia.round', dia.round,
                    [['down', 'срезать не меньше нужного'], ['up', 'не срезать лишнего']]) + '</div>'
                + numField('Наименьший диаметр', 'v:dia.minD', dia.minD, 'мм')
                + checkField('Подобрать общую шайбу на стояк', 'v:dia.riser', dia.riser)
                + checkField('Считать по напору общей насосной', 'v:dia.station', dia.station)
                + (res.station
                    ? '<p class="note-warn">Насосная «' + esc(res.station.name) + '»: напор ' + n2(res.station.H) + ' м'
                        + (res.station.by ? ' задаёт ' + esc(res.station.by) : '') + ', свой — ' + n2(res.pumpHead)
                        + ' м. Давления у этажей и диафрагмы посчитаны по напору насосной.</p>'
                    : '')
                + '<p class="hint">Шайба на поэтажном отводе срезает лишний напор у врезки: на нижних этажах его тем больше, '
                + 'чем выше стояк. Диаметр округляется вверх по шагу, поэтому срез чуть меньше — сети этажа хватит. '
                + 'Общая шайба на стояке снимает излишек, одинаковый для всех его этажей, и работает только при протоке.</p>'
                : ''));

        var vpvs = book.systems.filter(function (x) { return x.kind === 'vpv'; });
        html += section('Пожарные краны на стояке АПТ',
            checkField('ПК стоят на стояке АПТ — расходы в стояке суммируются', 'v:pk.onRiser', v.pk.onRiser)
            + (v.pk.onRiser
                ? selectField('Система ВПВ, чьи краны на стояке', 'v:pk.vpv', v.pk.vpv, [['', '— выберите —']].concat(vpvs.map(function (x) {
                    return [x.id, x.code + (x.title ? ' — ' + x.title : '')];
                })))
                + '<p class="hint">По стояку, магистрали и узлу управления идёт Q АПТ + Q ВПВ' + (res.vpv && res.vpv.sys
                    ? ' = ' + n2(res.dict ? res.dict.Q : 0) + ' + ' + n2(res.vpv.Q) + ' л/с' : '') + '. Если краны на своём стояке — галочку снимите, '
                    + 'а общую насосную задайте в окне «Системы…».</p>'
                : '<p class="hint">Краны на отдельном стояке ВПВ: АПТ считается одна, а насосная объединяет системы в окне «Системы…».</p>'));

        var st = Stations.stationOf(book, s.id);
        html += section('Насосная',
            (st ? '<p>Входит в «<b>' + esc(st.name) + '</b>» вместе с: '
                + esc(st.systems.filter(function (id) { return id !== s.id; }).map(function (id) {
                    var x = Systems.find(book, id);
                    return x ? x.code : id;
                }).join(', ') || '—') + '.</p>'
                : '<p class="hint">Система не входит ни в одну насосную.</p>')
            + '<div class="actions"><button data-action="open-stations">Насосные…</button></div>');

        rerender($('flrForm'), html);
    }

    /* --- схема ------------------------------------------------------------------ */

    function planGeometry(plan) {
        var p = plan.project;
        var src = p.nodes.filter(function (n) { return n.src; })[0];
        var ox = src ? src.x : 0;
        var oy = src ? src.y : 0;
        var byId = {};
        var extent = 1;
        p.nodes.forEach(function (n) {
            byId[n.id] = { x: n.x - ox, y: n.y - oy, spr: n.spr };
            extent = Math.max(extent, Math.abs(n.x - ox), Math.abs(n.y - oy));
        });
        return { nodes: byId, segments: p.segments, extent: extent };
    }

    function drawing(s, v, res) {
        if (!res.ok && !res.floors.length) return '<div class="empty">' + esc(res.errors.join(' ')) + '</div>';

        var iso = v.view === 'iso';
        var px = 15 * zoom;
        var colW = (iso ? 520 : 440) * zoom;
        var boxX = 150;
        var boxW = 110;
        var left = boxX + boxW + 80 * zoom;
        var zs = [v.baseElev, v.inlet.elev];

        res.floors.forEach(function (r) { zs.push(r.floor.elev + v.sprinklerHeight); zs.push(r.floor.elev); });

        var zmax = Math.max.apply(null, zs) + 5;
        var zmin = Math.min.apply(null, zs) - 3;
        var width = left + v.sections.length * colW + 80;
        var height = (zmax - zmin) * px + 110;
        var font = Math.max(10, 11 * zoom);
        var red = '#D2413A';
        var out = [];

        function Y(z) { return 60 + (zmax - z) * px; }
        function T(x, y, str, o) {
            o = o || {};
            return '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" font-size="' + (o.size || font) + '"'
                + (o.anchor ? ' text-anchor="' + o.anchor + '"' : '') + ' fill="' + (o.color || '#1B2A38') + '"'
                + (o.bold ? ' font-weight="700"' : '') + '>' + esc(str) + '</text>';
        }
        function L(x1, y1, x2, y2, color, w, dash) {
            return '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1)
                + '" stroke="' + color + '" stroke-width="' + (w || 1) + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>';
        }

        var mainY = Y(v.baseElev);
        var inletY = Y(v.inlet.elev);
        var boxMid = boxX + boxW / 2;

        out.push(T(16, 26, s.code + ' — ' + v.zone + (v.purpose ? ', ' + v.purpose : '') + (iso ? ' · изометрия' : ''), { size: font + 3, bold: true, color: '#1D6FB8' }));
        out.push(L(10, inletY, boxX, inletY, '#C2185B', 2.5));
        out.push(T(10, inletY - 6, 'Нгар = ' + n2(v.inlet.guaranteed) + ' м', { color: '#C2185B' }));
        out.push(T(10, inletY + 16, 'отм. ' + Fmt.num(v.inlet.elev, 3), { color: '#5B7186' }));
        out.push('<rect x="' + boxX + '" y="' + (Math.min(inletY, mainY) - 22).toFixed(1) + '" width="' + boxW + '" height="'
            + (Math.abs(inletY - mainY) + 44).toFixed(1) + '" fill="#FFF" stroke="#1B2A38" stroke-dasharray="5 3"/>');
        out.push(T(boxMid, Math.min(inletY, mainY) - 30, 'Насосная, УУ', { anchor: 'middle', bold: true }));

        if (res.ok) {
            out.push(T(boxMid, Math.max(inletY, mainY) + 40, 'Q = ' + n2(res.dict.Qr) + ' л/с', { anchor: 'middle', color: red }));
            out.push(T(boxMid, Math.max(inletY, mainY) + 40 + font + 3, 'Нр = ' + n2(res.pumpHead) + ' м', { anchor: 'middle', color: red, bold: true }));
        }
        out.push(L(boxX + boxW, mainY, left + (v.sections.length - 1) * colW + 40, mainY, red, 3));

        v.sections.forEach(function (sec, i) {
            var x = left + i * colW + 40;
            var recs = res.floors.filter(function (r) { return r.section === sec; });
            var top = recs.length ? Math.max.apply(null, recs.map(function (r) { return r.floor.elev + v.sprinklerHeight; })) : v.baseElev;
            var hasDict = recs.some(function (r) { return r === res.dict; });

            out.push(T(x, Y(top) - 26, 'Секция ' + sec.name + (hasDict ? ' — диктующая' : ''), { anchor: 'middle', bold: true, color: hasDict ? red : '#1B2A38' }));
            out.push(L(x, mainY, x, Y(top), red, hasDict ? 3 : 2.2));
            out.push(T(x - 8, mainY + font + 6, 'L = ' + Fmt.trim(sec.mainLen, 2) + ' м', { anchor: 'end', color: '#5B7186' }));

            recs.forEach(function (r) {
                var floorY = Y(r.floor.elev);
                var y = Y(r.floor.elev + v.sprinklerHeight);
                var isDict = r === res.dict;

                out.push(L(i === 0 ? boxX + boxW + 6 : x - 90 * zoom, floorY, x + colW - 60 * zoom, floorY, '#DCE7F2', 1, '4 3'));
                if (i === 0) out.push(T(8, floorY - 3, r.floor.label + '  ' + (r.floor.elev >= 0 ? '+' : '') + Fmt.num(r.floor.elev, 3), { color: '#5B7186', size: font - 1 }));
                if (!r.plan) return;

                var color = isDict ? red : r.ok ? '#B03A2E' : '#9AA7B4';
                var label = r.plan.name + (r.ok ? ' · Q ' + n2(r.Q) + ' л/с · Нтр ' + n2(r.Htr) + ' м' : ' · не считается')
                    + (r.dia && r.dia.ok ? ' · шайба ⌀' + Fmt.trim(r.dia.d, 1) : '');
                var group = ['<g class="floor-stub" data-plan="' + r.plan.id + '"><title>' + esc(r.floor.label + ': ' + label + ' — щелчок открывает план') + '</title>'];

                if (iso) {
                    var g = planGeometry(r.plan);
                    var scale = Math.min(18 * zoom, 190 * zoom / Math.max(g.extent, 1));
                    var c = Math.cos(Math.PI / 6) * scale;
                    var sn = Math.sin(Math.PI / 6) * scale;
                    function P(node) { return { x: x + 14 + (node.x - node.y) * c, y: y + (node.x + node.y) * sn * -1 + 0 }; }

                    group.push('<rect x="' + (x + 4) + '" y="' + (y - 200 * zoom).toFixed(1) + '" width="' + (colW - 70 * zoom).toFixed(1)
                        + '" height="' + (220 * zoom).toFixed(1) + '" fill="transparent"/>');
                    group.push(L(x, y, x + 14, y, color, isDict ? 2.2 : 1.6));
                    g.segments.forEach(function (sg) {
                        var a = g.nodes[sg.a];
                        var b = g.nodes[sg.b];
                        if (!a || !b) return;
                        var pa = P(a);
                        var pb = P(b);
                        group.push(L(pa.x, pa.y, pb.x, pb.y, color, sg.role === 'main' ? (isDict ? 2 : 1.5) : 1));
                    });
                    Object.keys(g.nodes).forEach(function (id) {
                        var n = g.nodes[id];
                        if (!n.spr) return;
                        var pn = P(n);
                        group.push('<circle cx="' + pn.x.toFixed(1) + '" cy="' + pn.y.toFixed(1) + '" r="' + (2.2 * zoom).toFixed(1) + '" fill="' + color + '"/>');
                    });
                    group.push(T(x + colW - 70 * zoom, floorY - 4, label, { anchor: 'end', size: font - 1, color: color, bold: isDict }));
                } else {
                    var stub = 120 * zoom;
                    var count = Math.min(6, Math.max(1, sprinklerCount(r.plan.project)));
                    group.push('<rect x="' + (x + 2) + '" y="' + (y - 12).toFixed(1) + '" width="' + (colW - 70 * zoom).toFixed(1) + '" height="24" fill="transparent"/>');
                    group.push(L(x, y, x + stub, y, color, isDict ? 2.4 : 1.8));
                    group.push('<rect x="' + (x + 8) + '" y="' + (y - 4).toFixed(1) + '" width="7" height="8" fill="#FFF" stroke="' + color + '"/>');
                    for (var k = 0; k < count; k++) {
                        var sx = x + 30 * zoom + k * (stub - 34 * zoom) / Math.max(1, count - 1);
                        group.push(L(sx, y, sx, y + 6 * zoom, color, 1.2));
                        group.push('<circle cx="' + sx.toFixed(1) + '" cy="' + (y + 8 * zoom).toFixed(1) + '" r="' + (2.6 * zoom).toFixed(1) + '" fill="' + color + '"/>');
                    }
                    group.push(T(x + stub + 8, y + 4, label, { size: font - 1, color: color, bold: isDict }));
                }

                group.push('</g>');
                out.push(group.join(''));
            });
        });

        return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width.toFixed(0) + '" height="' + height.toFixed(0) + '" viewBox="0 0 '
            + width.toFixed(0) + ' ' + height.toFixed(0) + '" font-family="Segoe UI, Arial, sans-serif">' + out.join('') + '</svg>';
    }

    /* --- справа ------------------------------------------------------------------ */

    function card(title, value, note, cls) {
        return '<div class="card ' + (cls || '') + '"><div class="card-title">' + esc(title) + '</div><div class="card-value">'
            + esc(value) + '</div><div class="card-note">' + esc(note || '') + '</div></div>';
    }

    function renderCalc(s, v, res) {
        if (!res.ok) {
            return '<div class="empty">' + esc(res.errors.join(' ')) + '</div>'
                + (res.warnings.length ? '<ul class="warnings">' + res.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '');
        }

        var d = res.dict;
        var st = Stations.stationOf(App.book, s.id);
        var need = st ? Stations.need(App.book, st) : null;

        var html = '<div class="cards small">'
            + card('Расход АПТ', n2(d.Q) + ' л/с', d.Qr > d.Q + 1e-9 ? 'по стояку с ПК ' + n2(d.Qr) + ' л/с' : d.plan.name)
            + card('Нтр', n2(d.Htr) + ' м', 'секция ' + d.section.name + ', ' + d.floor.label)
            + card('Нр насоса', n2(res.pumpHead) + ' м', res.pumpHead > 0 ? '' : 'насос не нужен', res.pumpHead > 0 ? '' : 'ok')
            + (need ? card('Насосная «' + st.name + '»', n2(need.Q) + ' л/с · ' + n2(need.H) + ' м',
                (st.sumFlows ? 'сумма расходов' : 'наибольший расход') + ', напор по ' + (need.dict ? need.dict.sys.code : '—')) : '')
            + '</div>'
            + (res.station
                ? '<p class="note-warn">Давления у этажей посчитаны по напору общей насосной «' + esc(res.station.name) + '» — '
                    + n2(res.station.H) + ' м' + (res.station.by ? ' (задаёт ' + esc(res.station.by) + ')' : '')
                    + ', свой требуемый напор системы ' + n2(res.pumpHead) + ' м.</p>'
                : '')
            + (res.warnings.length ? '<ul class="warnings">' + res.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '');

        html += '<h4 class="pipes-title">Диктующий этаж — ' + esc(d.section.name + ', ' + d.floor.label) + ', план «' + esc(d.plan.name) + '»</h4>'
            + '<table class="grid"><tbody>'
            + [
                ['Нгеом = отм. этажа + h оросителей − отм. ввода', Fmt.num(d.floor.elev, 3) + ' + ' + Fmt.trim(v.sprinklerHeight, 2) + ' − (' + Fmt.num(v.inlet.elev, 3) + ')', d.Hgeom],
                ['Ннас — потери в насосной', '', v.inlet.stationLoss],
                ['ΣΔH сети этажа (из плана)', '', d.HplanRaw],
                ['ΔH стояка = Q²·L/Kт', n2(d.Qr) + '²·' + n2(d.Lr) + '/' + Fmt.kt(res.riser.kt), d.dHr],
                ['ΔH магистрали = Q²·L/Kт', n2(d.Qr) + '²·' + n2(d.section.mainLen) + '/' + Fmt.kt(res.main.kt), d.dHm],
                ['Нсети = ΣΔH · ' + Fmt.trim(v.inlet.localFactor, 2), n2(d.netRaw) + ' · ' + Fmt.trim(v.inlet.localFactor, 2), d.Hnet],
                ['Нуу = 1000·ξ·(Q·3,6)²', 'ξ = ' + String(res.xi), d.Hcu],
                ['Нсв у диктующего оросителя', '', d.Hfree],
                ['Поэтажный узел', '', v.floorNodeLoss],
                ['Нвсас', '', v.inlet.suction]
            ].map(function (r) {
                return '<tr><td>' + esc(r[0]) + '</td><td class="dim">' + esc(r[1]) + '</td><td class="num">' + Fmt.num(r[2], 3) + '</td></tr>';
            }).join('')
            + '<tr class="total-row"><td colspan="2">Нтр</td><td class="num">' + n2(d.Htr) + '</td></tr>'
            + '<tr class="total-row"><td colspan="2">Нр = Нтр − Нгар (' + n2(v.inlet.guaranteed) + ')</td><td class="num">' + n2(d.Hp) + '</td></tr>'
            + '</tbody></table>';

        html += '<h4 class="pipes-title">Все этажи</h4>'
            + '<table class="grid"><thead><tr><th>Секция</th><th>Этаж</th><th>Отм.</th><th>План</th><th>Q, л/с</th><th>Q стояк</th>'
            + '<th>ΔH ст</th><th>ΔH маг</th><th>Нсети</th><th>Нуу</th><th>Нтр</th><th>Нр</th><th>Запас</th></tr></thead><tbody>'
            + res.floors.map(function (r) {
                if (!r.plan) {
                    return '<tr class="dim"><td>' + esc(r.section.name) + '</td><td>' + esc(r.floor.label) + '</td><td class="num">'
                        + Fmt.num(r.floor.elev, 3) + '</td><td colspan="10">без АПТ</td></tr>';
                }
                if (!r.ok) {
                    return '<tr><td>' + esc(r.section.name) + '</td><td>' + esc(r.floor.label) + '</td><td class="num">' + Fmt.num(r.floor.elev, 3)
                        + '</td><td>' + esc(r.plan.name) + '</td><td colspan="9" class="bad">' + esc((r.errors || []).join(' ')) + '</td></tr>';
                }
                return '<tr class="' + (r === d ? 'selected' : '') + '"><td>' + esc(r.section.name) + '</td><td>' + esc(r.floor.label) + '</td><td class="num">'
                    + Fmt.num(r.floor.elev, 3) + '</td><td><a href="#" data-action="open-plan:' + r.plan.id + '">' + esc(r.plan.name) + '</a></td>'
                    + '<td class="num">' + n2(r.Q) + '</td><td class="num">' + n2(r.Qr) + '</td><td class="num">' + Fmt.num(r.dHr, 3)
                    + '</td><td class="num">' + Fmt.num(r.dHm, 3) + '</td><td class="num">' + n2(r.Hnet) + '</td><td class="num">' + n2(r.Hcu)
                    + '</td><td class="num">' + n2(r.Htr) + '</td><td class="num">' + n2(r.Hp) + '</td><td class="num">' + n2(r.excess) + '</td></tr>';
            }).join('') + '</tbody></table>'
            + '<p class="hint">Запас — на сколько напор у врезки этажа при работе насоса больше нужного сети этажа. '
            + 'Большой запас на нижних этажах — повод поставить регулятор давления или диафрагму.</p>';

        html += diaphragmTable(v, res);
        return html;
    }

    /** Подобранные шайбы: по одной на этаж и общая на стояк. */
    function diaphragmTable(v, res) {
        if (!v.dia.on || !res.dia) return '';

        var rows = res.dia.risers.map(function (r) {
            return '<tr class="selected"><td>' + esc(r.section.name) + '</td><td>стояк, у магистрали</td>'
                + '<td class="num">' + n2(r.pick.q || 0) + '</td><td class="num">' + n2(r.pick.need) + '</td>'
                + '<td class="num">' + Fmt.num(r.pick.exact, 1) + '</td><td class="num"><b>' + Fmt.trim(r.pick.d, 1) + '</b></td>'
                + '<td class="num">' + n2(r.pick.cut) + '</td><td class="dim">общая для стояка</td></tr>';
        });

        res.floors.forEach(function (rec) {
            if (!rec.dia || !rec.dia.ok) return;
            rows.push('<tr><td>' + esc(rec.section.name) + '</td><td>' + esc(rec.floor.label) + '</td>'
                + '<td class="num">' + n2(rec.Q) + '</td><td class="num">' + n2(rec.need) + '</td>'
                + '<td class="num">' + Fmt.num(rec.dia.exact, 1) + '</td><td class="num"><b>' + Fmt.trim(rec.dia.d, 1) + '</b></td>'
                + '<td class="num">' + n2(rec.dia.cut) + '</td><td class="num">' + n2(rec.after) + '</td></tr>');
        });

        if (!rows.length) {
            return '<h4 class="pipes-title">Диафрагмы</h4><p class="hint">Срезать нечего: лишнего напора у врезок нет.</p>';
        }

        return '<h4 class="pipes-title">Диафрагмы — '
            + (v.dia.mode === 'fixed' ? 'срез до ' + n2(v.dia.target) + ' м' : 'срез до нужного сети этажа'
                + (v.dia.margin ? ' с запасом ' + n2(v.dia.margin) + ' м' : '')) + '</h4>'
            + '<table class="grid"><thead><tr><th>Секция</th><th>Где</th><th>Q, л/с</th><th>Срезать, м</th>'
            + '<th>⌀ расчётный, мм</th><th>⌀ принятый, мм</th><th>Срежет, м</th><th>Станет, м</th></tr></thead><tbody>'
            + rows.join('') + '</tbody></table>'
            + '<p class="hint">Диаметр округлён вверх по шагу ' + Fmt.trim(v.dia.step, 2) + ' мм: срез чуть меньше нужного, '
            + 'напор у этажа остаётся не ниже требуемого. Шайба на стояке снижает давление только при протоке.</p>';
    }

    function appendix(s, v, res) {
        if (!res.ok) return '<p class="empty">' + esc(res.errors.join(' ')) + '</p>';

        var d = res.dict;
        var i = v.inlet;
        var lines = [];
        function add(text, cls) { lines.push('<p class="r-' + (cls || 'text') + '">' + esc(text) + '</p>'); }

        add('Определение требуемого напора в системе ' + s.code, 'title');
        add(s.code + ' — ' + v.zone + (v.purpose ? ', ' + v.purpose : ''), 'title');
        add('Гидравлический расчёт выполнен по методике СП 485.1311500.2020 (приложение Б) для диктующего этажа: секция '
            + d.section.name + ', ' + d.floor.label + ', отм. ' + Fmt.num(d.floor.elev, 3) + ', план «' + d.plan.name + '».');
        add('Требуемый напор:', 'sub');
        add('Нтр = Нгеом + Ннас + Нсети + Нуу + Нсв + Нпу + Нвсас, где', 'formula');
        add('Нгеом = ' + Fmt.num(d.floor.elev, 3) + ' + ' + Fmt.trim(v.sprinklerHeight, 2) + ' − (' + Fmt.num(i.elev, 3) + ') = ' + n2(d.Hgeom) + ' м — геометрическая высота;', 'formula');
        add('Ннас = ' + n2(i.stationLoss) + ' м — потери в насосной станции;', 'formula');
        add('Нсети = (ΣΔHэтажа + ΔHст + ΔHмаг) · ' + Fmt.trim(i.localFactor, 2) + ' = (' + Fmt.num(d.HplanRaw, 3) + ' + ' + Fmt.num(d.dHr, 3)
            + ' + ' + Fmt.num(d.dHm, 3) + ') · ' + Fmt.trim(i.localFactor, 2) + ' = ' + n2(d.Hnet) + ' м;', 'formula');
        add('ΔHст = Q²·L/Kт = ' + n2(d.Qr) + '² · ' + n2(d.Lr) + ' / ' + Fmt.kt(res.riser.kt) + ' = ' + Fmt.num(d.dHr, 3) + ' м (стояк '
            + res.riser.od + '×' + res.riser.wall + ');', 'formula');
        add('Нуу = 1000·ξ·(Q·3,6)² = ' + n2(d.Hcu) + ' м — потери в узле управления ' + i.cuKind + ' Ду' + i.cuDn + ';', 'formula');
        add('Нсв = ' + n2(d.Hfree) + ' м — свободный напор у диктующего оросителя;', 'formula');
        add('Нпу = ' + n2(v.floorNodeLoss) + ' м — потери в поэтажном узле; Нвсас = ' + n2(i.suction) + ' м.', 'formula');
        add('Нтр = ' + [d.Hgeom, i.stationLoss, d.Hnet, d.Hcu, d.Hfree, v.floorNodeLoss, i.suction].map(n2).join(' + ') + ' = ' + n2(d.Htr) + ' м.', 'result');
        add('Нр = Нтр − Нгар = ' + n2(d.Htr) + ' − ' + n2(i.guaranteed) + ' = ' + n2(d.Hp) + ' м.', 'result');
        if (d.Hp <= 0) add('Гарантированного напора достаточно: насосная установка не требуется.');
        add('Расчётный расход: Q = ' + n2(d.Q) + ' л/с' + (d.Qr > d.Q + 1e-9 ? '; по стояку с пожарными кранами ' + n2(d.Qr) + ' л/с' : '') + '.', 'result');

        return lines.join('');
    }

    function renderTabs() {
        $('flrTabs').innerHTML = [['calc', 'Расчёт'], ['output', 'Вывод']].map(function (t) {
            return '<button data-tab="' + t[0] + '"' + (t[0] === tab ? ' class="active"' : '') + '>' + t[1] + '</button>';
        }).join('');
    }

    function updateTop(res) {
        var summary = $('summary');
        if (!res.ok) {
            summary.innerHTML = '<span class="dim">' + esc(res.errors.join(' ')) + '</span>';
            return;
        }
        summary.innerHTML = '<span>Q <b>' + n2(res.dict.Qr) + '</b> л/с</span><span>Нтр <b>' + n2(res.dict.Htr) + '</b> м</span>'
            + '<span>Нр <b>' + n2(res.pumpHead) + '</b> м</span>'
            + (res.warnings.length ? '<span class="warn" title="' + esc(res.warnings.join('\n')) + '">замечаний: ' + res.warnings.length + '</span>' : '');
    }

    function refresh() {
        var s = sys();
        if (!s) return;
        var v = s.floors;
        var res = Floors.solve(v, App.book);
        last = res;

        renderForm(s, v, res);
        $('flrCanvas').innerHTML = drawing(s, v, res);
        renderTabs();
        rerender($('flrBody'), tab === 'output'
            ? '<div class="calc-bar"><button data-action="flr-print" class="primary">Печать / PDF</button></div><div class="report">' + appendix(s, v, res) + '</div>'
            : renderCalc(s, v, res));
        updateTop(res);

        $('flrViewFlat').classList.toggle('active', v.view !== 'iso');
        $('flrViewIso').classList.toggle('active', v.view === 'iso');
    }

    /* --- события ------------------------------------------------------------------ */

    function applyValue(v, path, value) {
        var parts = path.split('.');
        var target = v;
        for (var i = 0; i < parts.length - 1; i++) target = target[parts[i]];
        var key = parts[parts.length - 1];

        if (typeof value === 'boolean') { target[key] = value; return; }

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
            if (best) { target.od = best.od; target.wall = best.wall; }
            return;
        }
        if (['zone', 'purpose', 'cuKind', 'vpv', 'mode', 'round'].indexOf(key) >= 0) {
            target[key] = String(value);
            if (key === 'cuKind') {
                var dns = Catalog.CONTROL_UNITS.filter(function (u) { return u.kind === value; }).map(function (u) { return u.dn; });
                if (dns.length && dns.indexOf(target.cuDn) < 0) target.cuDn = dns[0];
            }
            return;
        }

        var num = Fmt.parse(value);
        if (key === 'cuXi') { target[key] = num > 0 ? num : null; return; }
        if (num === null) return;
        target[key] = num;
    }

    function onChange(e) {
        var el = e.target;
        var key = el.dataset ? el.dataset.key : null;
        if (!key) return;
        var value = el.type === 'checkbox' ? el.checked : el.value;
        var parts = key.split(':');

        setTimeout(function () {
            var s = sys();
            if (!s) return;
            var v = s.floors;

            if (parts[0] === 'v') {
                applyValue(v, parts[1], value);
            } else if (parts[0] === 'kind') {
                /*
                    Тип установки — свойство всей системы, а не отдельного
                    плана: расчёт живёт в планах, поэтому значение раздаётся
                    сразу всем, иначе записка возьмёт его с диктующего плана
                    и покажет не то, что ждут.
                */
                v.plans.forEach(function (p) {
                    p.project.settings.systemKind = String(value);
                    if (String(value) !== 'воздухозаполненная') p.project.settings.coldRoom = false;
                });
            } else if (parts[0] === 'cold') {
                v.plans.forEach(function (p) { p.project.settings.coldRoom = !!value; });
            } else if (parts[0] === 'sys') {
                s[parts[1]] = String(value).trim();
                if (parts[1] === 'code') v.plans.forEach(function (p) { p.project.settings.systemName = s.code; });
            } else if (parts[0] === 'pl') {
                var plan = Floors.findPlan(v, parts[1]);
                if (!plan) return;
                if (parts[2] === 'name') {
                    plan.name = String(value).trim() || plan.name;
                    plan.project.name = plan.name;
                } else if (parts[2] === 'section') {
                    plan.section = String(value);
                } else {
                    var n = Fmt.parse(value);
                    if (n === null) return;
                    plan[parts[2]] = Math.round(n);
                }
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

            App.afterEdit('АПТ по этажам ' + s.code);
        }, 0);
    }

    function onClick(e) {
        var b = e.target.closest('[data-action]');
        var stub = e.target.closest('.floor-stub');
        var s = sys();
        if (!s) return;

        if (!b && stub) {
            App.openPlan(s.id, stub.dataset.plan);
            return;
        }
        if (!b) return;

        e.preventDefault();
        var parts = b.dataset.action.split(':');
        var v = s.floors;

        switch (parts[0]) {
            case 'open-plan':
                App.openPlan(s.id, parts[1]);
                break;
            case 'plan-add': {
                var plan = Floors.addPlan(v);
                plan.project.settings.systemName = s.code;
                App.afterEdit('план этажа');
                break;
            }
            case 'plan-dup': {
                var src = Floors.findPlan(v, parts[1]);
                if (src) {
                    Floors.addPlan(v, src);
                    App.afterEdit('копия плана этажа');
                }
                break;
            }
            case 'plan-del': {
                var del = Floors.findPlan(v, parts[1]);
                if (del && v.plans.length > 1 && window.confirm('Удалить план «' + del.name + '»? Отменить можно кнопкой «Отменить».')) {
                    v.plans = v.plans.filter(function (p) { return p !== del; });
                    App.afterEdit('удаление плана этажа');
                }
                break;
            }
            case 'sec-add':
                Floors.addSection(v);
                App.afterEdit('секция');
                break;
            case 'sec-del':
                if (v.sections.length > 1) {
                    v.sections = v.sections.filter(function (x) { return String(x.id) !== parts[1]; });
                    v.plans.forEach(function (p) { if (String(p.section) === parts[1]) p.section = 'all'; });
                    App.afterEdit('удаление секции');
                }
                break;
            case 'open-stations':
                Systems.openManager();
                break;
            case 'flr-print':
                $('printArea').innerHTML = '<div class="report">' + appendix(s, v, last) + '</div>';
                App.print();
                break;
        }
    }

    function init() {
        [$('flrForm'), $('flrBody'), $('flrCanvas')].forEach(function (el) {
            el.addEventListener('change', onChange);
            el.addEventListener('click', onClick);
        });

        $('flrTabs').addEventListener('click', function (e) {
            var b = e.target.closest('button[data-tab]');
            if (!b) return;
            tab = b.dataset.tab;
            refresh();
        });

        $('flrZoomIn').addEventListener('click', function () { zoom = Math.min(3, zoom * 1.25); refresh(); });
        $('flrZoomOut').addEventListener('click', function () { zoom = Math.max(0.4, zoom / 1.25); refresh(); });

        [['flrViewFlat', 'flat'], ['flrViewIso', 'iso']].forEach(function (pair) {
            $(pair[0]).addEventListener('click', function () {
                var s = sys();
                if (!s || s.floors.view === pair[1]) return;
                s.floors.view = pair[1];
                App.afterEdit('вид схемы');
            });
        });
    }

    return {
        init: init,
        refresh: refresh,
        appendix: appendix,
        drawing: drawing,
        last: function () { return last; }
    };
})();
