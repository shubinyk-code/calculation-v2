/*
    Подвкладка «Схема»: панель инструментов, холст и инспектор выбранного объекта.

    Инспектор — это форма параметров того, что выбрано на холсте: трубы, узла
    или блока стояка. Щелчок по коллекторному узлу этажа внутри блока стояка
    открывает «этаж N стояка»: там можно сменить типовой этаж или число людей и
    перейти в «Этажную разводку».
*/

var UiHydScheme = (function () {
    'use strict';

    var esc = Format.html;
    var num = Format.num;
    var body, state, reg;
    var hint = '';

    var KINDS = {
        input: 'Ввод водопровода', meter: 'Водомерный узел', pump: 'Насосная установка', itp: 'ИТП',
        tee: 'Узел ветвления', buildin: 'Встроенное помещение', riser: 'Блок стояка'
    };

    function hyd() { return App.project.hyd; }
    function result() { return UiHyd.result; }

    function init(b, s, r) {
        body = b;
        state = s;
        reg = r;
        state.wizard = { sections: 1, risers: 2, floors: 9, zones: 1 };
        state.wizardOpen = false;

        body.addEventListener('click', onClick);
        body.addEventListener('change', onChange);
    }

    function api() {
        return {
            hyd: hyd,
            result: result,
            changed: function () { UiHyd.changed(false); },
            select: function (sel) { state.selected = sel; redrawInspector(); HydCanvas.render(result()); },
            openFloors: UiHyd.openFloors,
            say: say,
            tool: toolState
        };
    }

    /* --- страница --------------------------------------------------------------- */

    function show(res) {
        reg.length = 0;

        body.innerHTML =
            '<div class="card no-print cv-card">'
            + '<div class="cv-bar"><div class="subtabs cv-tools" id="cvTools">' + HydCanvas.toolbar(state) + '</div>'
            + '<div class="subtabs" id="cvSheets">'
            + '<button type="button" data-sheet="c" class="' + (state.net === 'c' ? 'on' : '') + '">ХВС</button>'
            + '<button type="button" data-sheet="h" class="' + (state.net === 'h' ? 'on' : '') + '">ГВС</button></div>'
            + zoneSelect(res)
            + pointsSelect(res)
            + '<label class="check"><input type="checkbox" id="cvSnap"' + (state.snap ? ' checked' : '') + '> сетка 10</label>'
            + '<label class="check"><input type="checkbox" id="cvOrtho"' + (state.ortho ? ' checked' : '') + '> под прямым углом</label>'
            + '<label class="field" style="flex-direction:row;align-items:center;gap:6px">Напоры на этажах<select id="cvHead">'
            + [['dyn', 'динамические'], ['stat', 'статические'], ['off', 'скрыть']].map(function (o) { return '<option value="' + o[0] + '"' + (state.showHead === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>'
            + '<button type="button" class="small" data-sv="fit">Вписать</button>'
            + '<button type="button" class="small" data-sv="dxf" title="Схемы ХВС и ГВС в AutoCAD: слои, блоки и обозначения как в образце">В AutoCAD (DXF)</button>'
            + '<button type="button" class="small" data-sv="pdfView" title="Расчётная схема так, как она нарисована на экране (подписи участков, стояки, напоры), векторный PDF большого формата: листы ХВС и ГВС">В PDF (как на экране)</button>'
            + '<button type="button" class="small" data-sv="pdf" title="Чертёж схем ХВС и ГВС в масштабе 1:100…1:2000, как в AutoCAD, векторный PDF большого формата">В PDF (чертёж)</button>'
            + '<button type="button" class="small" data-sv="hot" title="Копирует трассу ХВС на лист ГВС от ответвления на ИТП">ГВС по трассе ХВС</button>'
            + '<button type="button" class="small" data-sv="wizard">Стартовая схема…</button>'
            + '<button type="button" class="small danger" data-sv="clear">Очистить</button>'
            + '</div>'
            + '<div class="cv-hint" id="cvHint">' + esc(hint || toolHint()) + '</div>'
            + '<div class="cv-layout"><div id="cvHost" class="cv-host"></div><div id="cvInsp" class="cv-insp"></div></div>'
            + '<div id="cvWarn"></div>'
            + '</div>';

        HydCanvas.init(document.getElementById('cvHost'), state, api());

        if (!state.fitted) { HydCanvas.fit(); state.fitted = true; }

        redrawCanvas(res);
        redrawInspector();
    }

    /* Переключатель зон: показать схему одной насосной установки, остальное приглушить. */
    /* Расчётные точки диктующего пути выбранной системы. */
    function pointsSelect(res) {
        var list = res ? res.systems.filter(function (s) { return s.route; }) : [];
        var cur = state.points === 'auto' ? (list[0] ? list[0].id : '') : state.points;
        return '<label class="field" style="flex-direction:row;align-items:center;gap:6px">Расчётные точки<select id="cvPts"><option value=""' + (cur === '' ? ' selected' : '') + '>нет</option>'
            + list.map(function (s) { return '<option value="' + esc(s.id) + '"' + (cur === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label>';
    }

    function zoneSelect(res) {
        var list = res ? res.systems : [];
        if (state.zone && !list.some(function (s) { return s.id === state.zone; })) state.zone = '';
        return '<label class="field" style="flex-direction:row;align-items:center;gap:6px">Зона<select id="cvZone"><option value="">Вся схема</option>'
            + list.map(function (s) { return '<option value="' + esc(s.id) + '"' + (state.zone === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label>';
    }

    function redraw(res) {
        if (!document.getElementById('cvHost')) { UiHyd.renderBody(); return; }
        if (state.selected && !selectionAlive()) state.selected = null;
        if (!state.selected || state.selected.type !== 'multi') state.multi = [];
        reg.length = 0;
        redrawCanvas(res);
        redrawInspector();
    }

    function redrawCanvas(res) {
        HydCanvas.render(res);

        var warn = document.getElementById('cvWarn');
        if (!warn) return;

        if (!res || !res.warnings.length) { warn.innerHTML = ''; return; }

        warn.innerHTML = '<div class="verdict unknown"><b>Замечания расчёта (' + res.warnings.length + ')</b><ul style="margin:6px 0 0;padding-left:18px">'
            + res.warnings.slice(0, 10).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('')
            + (res.warnings.length > 10 ? '<li>… и ещё ' + (res.warnings.length - 10) + '</li>' : '') + '</ul></div>';
    }

    function selectionAlive() {
        var s = state.selected;
        var h = hyd();
        if (s.type === 'node') return !!HydModel.nodeById(h, s.id);
        if (s.type === 'pipe') return h.canvas.pipes.some(function (p) { return p.id === s.id; });
        if (s.type === 'floor') return !!HydModel.nodeById(h, s.riser);
        if (s.type === 'multi') return s.ids.every(function (id) { return !!HydModel.nodeById(h, id); });
        return false;
    }

    function say(text) {
        hint = text;
        var el = document.getElementById('cvHint');
        if (el) el.textContent = text;
    }

    function toolHint() {
        var t = HydCanvas.TOOLS.filter(function (x) { return x[0] === state.tool; })[0];
        return t ? t[1] + ': ' + t[2] : '';
    }

    function toolState() {
        hint = '';
        var el = document.getElementById('cvTools');
        if (el) el.innerHTML = HydCanvas.toolbar(state);
        var h = document.getElementById('cvHint');
        if (h) h.textContent = toolHint();
        var svg = document.querySelector('svg.cv');
        if (svg) svg.setAttribute('data-cursor', state.tool);
    }

    /* --- события ------------------------------------------------------------------ */

    function onChange(e) {
        var id = e.target.id;
        if (id === 'cvSnap') state.snap = e.target.checked;
        else if (id === 'cvOrtho') state.ortho = e.target.checked;
        else if (id === 'cvZone') {
            state.zone = e.target.value;
            state.selected = null;
            state.multi = [];
            HydCanvas.render(result());
            HydCanvas.fit();
            redrawInspector();
        }
        else if (id === 'cvPts') { state.points = e.target.value; HydCanvas.render(result()); }
        else if (id === 'cvHead') { state.showHead = e.target.value; HydCanvas.render(result()); }
    }

    function onClick(e) {
        var tool = e.target.closest('[data-tool]');

        if (tool) {
            HydCanvas.cancelDrawing();
            state.tool = tool.getAttribute('data-tool');
            hint = '';
            toolState();
            return;
        }

        var sheet = e.target.closest('[data-sheet]');

        if (sheet) {
            HydCanvas.cancelDrawing();
            state.net = sheet.getAttribute('data-sheet');
            state.selected = null;
            state.fitted = false;
            UiHyd.renderBody();
            return;
        }

        var sv = e.target.closest('[data-sv]');
        if (!sv) return;

        var act = sv.getAttribute('data-sv');
        var arg = sv.getAttribute('data-arg');
        if (actions[act]) actions[act](arg);
    }

    function clone(x) { return JSON.parse(JSON.stringify(x)); }

    var actions = {
        pumpSheet: function (arg) { UiHydPumps.pickInto(arg); },
        fit: function () { HydCanvas.fit(); },
        pdf: function () {
            var res = result();
            if (!res || !res.input) { say('Нечего выгружать: на схеме нужен ввод и стояки.'); return; }
            say('Готовлю PDF…');
            setTimeout(function () {
                try {
                    HydPdf.save(res, hyd(), { points: state.points }).then(function () { say('Чертёж схем выгружен в PDF (векторный, масштаб указан на листе).'); },
                        function (e) { say('PDF не получился: ' + e.message); });
                } catch (e) { say('PDF не получился: ' + e.message); }
            }, 30);
        },
        pdfView: function () {
            var res = result();
            if (!res || !res.input) { say('Нечего выгружать: на схеме нужен ввод и стояки.'); return; }
            say('Готовлю PDF…');
            setTimeout(function () {
                try {
                    HydPdfView.save(hyd(), function (net) { return HydCanvas.snapshot(net, res); }).then(function () { say('Расчётная схема выгружена в PDF так, как она нарисована на экране.'); },
                        function (e) { say('PDF не получился: ' + e.message); });
                } catch (e) { say('PDF не получился: ' + e.message); }
            }, 30);
        },
        dxf: function () {
            var res = result();
            if (!res || !res.input) { say('Нечего выгружать: на схеме нужен ввод и стояки.'); return; }
            HydDxf.save(res, hyd(), { points: state.points });
            say('Схема выгружена в DXF (листы ХВС и ГВС одним файлом).');
        },
        hot: function () {
            var r = HydGraph.copyToHot(hyd());
            say(r.message);
            if (r.ok) { state.net = 'h'; state.fitted = false; state.selected = null; }
            UiHyd.changed(false);
            if (r.ok) UiHyd.renderBody();
        },
        wizard: function () {
            state.wizardOpen = !state.wizardOpen;
            state.selected = null;
            redrawInspector();
        },
        build: function () {
            if (!window.confirm('Схема будет заменена стартовой. Типы этажей сохранятся. Продолжить?')) return;
            var w = state.wizard;
            HydGraph.starter(hyd(), { sections: w.sections, risers: w.risers, floors: w.floors, zones: w.zones });
            state.zone = '';
            state.wizardOpen = false;
            state.selected = null;
            state.net = 'c';
            state.fitted = false;
            UiHyd.changed(false);
            UiHyd.renderBody();
        },
        clear: function () {
            if (!window.confirm('Удалить все объекты и трубы со схемы (оба листа)? Типы этажей сохранятся.')) return;
            hyd().canvas = { nodes: [], pipes: [] };
            hyd().pipes = {};
            hyd().lengths = {};
            hyd().pumpSel = {};
            state.selected = null;
            state.drawing = null;
            UiHyd.changed(false);
        },
        resetLevels: function (id) {
            var n = HydModel.nodeById(hyd(), id);
            n.level1 = null; n.heights = {}; n.elevs = {};
            UiHyd.changed(false);
        },
        resetLevelsGroup: function () {
            var s = state.selected;
            if (!s || s.type !== 'multi') return;
            s.ids.forEach(function (id) {
                var n = HydModel.nodeById(hyd(), id);
                if (n && n.kind === 'riser') { n.level1 = null; n.heights = {}; n.elevs = {}; }
            });
            UiHyd.changed(false);
        },
        levelsAll: function (id) {
            var d = hyd();
            var src = HydModel.nodeById(d, id);
            var risers = HydModel.risers(d).filter(function (r) { return r.id !== id; });
            if (!risers.length) { say('Других стояков нет.'); return; }
            if (!window.confirm('Скопировать отметки и высоты этажей этого стояка на остальные стояки (' + risers.length + ')? Отменить можно кнопкой «Отменить».')) return;
            risers.forEach(function (r) {
                r.level1 = src.level1;
                r.floorH = src.floorH;
                r.heights = JSON.parse(JSON.stringify(src.heights));
                r.elevs = JSON.parse(JSON.stringify(src.elevs));
            });
            say('Отметки этажей скопированы на стояков: ' + risers.length);
            UiHyd.changed(false);
        },
        dedupe: function () {
            var n = HydGraph.dropDuplicates(hyd());
            say(n ? 'Убрано дублирующих труб: ' + n : 'Дублей нет.');
            state.selected = null;
            UiHyd.changed(false);
        },
        prune: function () {
            var h = hyd();
            var res = result();
            if (!res || !res.net || !res.net.reached) return;
            var kill = h.canvas.nodes.filter(function (n) {
                if (n.kind !== 'tee') return false;
                return !res.net.reached[n.sheet === 'h' ? 'h' : 'c'][n.id];
            }).map(function (n) { return n.id; });
            kill.forEach(function (id) { HydGraph.removeNode(h, id); });
            say(kill.length ? 'Убрано висячих тройников: ' + kill.length : 'Висячих тройников нет.');
            state.selected = null;
            UiHyd.changed(false);
        },
        delMulti: function () {
            if (state.selected && state.selected.type === 'multi') HydCanvas.remove(state.selected);
        },
        clearSel: function () { state.selected = null; state.multi = []; redrawInspector(); HydCanvas.render(result()); },
        pickMeter: function (arg) {
            var n = state.selected && state.selected.type === 'node' ? HydModel.nodeById(hyd(), state.selected.id) : null;
            if (!n) return;
            var p = arg.split('|');
            n.chosen = { dn: parseInt(p[0], 10), kind: p[1], variant: p[2] || '' };
            UiHyd.changed(false);
        },
        autoMeter: function (id) {
            var n = HydModel.nodeById(hyd(), id);
            if (n) n.chosen = null;
            UiHyd.changed(false);
        },
        rotMeter: function (id) { HydCanvas.rotate(id); },
        delNode: function (id) { HydCanvas.remove({ type: 'node', id: id }); },
        delPipe: function (id) { HydCanvas.remove({ type: 'pipe', id: id }); },
        dupRiser: function (id) {
            var h = hyd();
            var n = HydModel.nodeById(h, id);
            var copy = clone(n);
            var fresh = HydModel.newNode(h, 'riser', n.x + 160, n.y);
            copy.id = fresh.id;
            copy.x = n.x + 160;
            copy.hx = n.hx + 160;
            copy.firstNumber = 0;
            h.canvas.nodes.push(copy);
            state.selected = { type: 'node', id: copy.id };
            UiHyd.changed(false);
        },
        addRange: function (id) {
            var n = HydModel.nodeById(hyd(), id);
            var last = n.ranges[n.ranges.length - 1];
            n.ranges.push({ from: Math.min(n.floorTo, last ? last.to + 1 : n.floorFrom), to: n.floorTo, typeId: last ? last.typeId : (hyd().floorTypes[0] ? hyd().floorTypes[0].id : '') });
            UiHyd.changed(false);
        },
        delRange: function (arg) {
            var p = arg.split(':');
            HydModel.nodeById(hyd(), p[0]).ranges.splice(+p[1], 1);
            UiHyd.changed(false);
        },
        addExc: function (id) {
            var n = HydModel.nodeById(hyd(), id);
            n.exceptions.push({ floor: n.floorFrom, typeId: hyd().floorTypes[0] ? hyd().floorTypes[0].id : '' });
            UiHyd.changed(false);
        },
        delExc: function (arg) {
            var p = arg.split(':');
            HydModel.nodeById(hyd(), p[0]).exceptions.splice(+p[1], 1);
            UiHyd.changed(false);
        },
        openFloors: function (arg) {
            var p = arg.split('|');
            UiHyd.openFloors(p[0], p[1]);
        },
        sepType: function (arg) {
            // отдельная копия типа этажа только для этого этажа стояка
            var p = arg.split('|');
            var h = hyd();
            var riser = HydModel.nodeById(h, p[0]);
            var floor = +p[1];
            var type = HydModel.typeById(h, HydModel.typeOfFloor(riser, floor));
            if (!type) return;
            var copy = clone(type);
            copy.id = HydModel.nextId('T', h.floorTypes);
            copy.name = type.name + ' · ' + (riser.name || riser.id) + ', эт. ' + floor;
            h.floorTypes.push(copy);
            riser.exceptions = riser.exceptions.filter(function (x) { return x.floor !== floor; });
            riser.exceptions.push({ floor: floor, typeId: copy.id });
            UiHyd.changed(false);
        }
    };

    /* --- инспектор ------------------------------------------------------------------ */

    function redrawInspector() {
        var el = document.getElementById('cvInsp');
        if (!el) return;
        reg.length = 0;
        var wide = state.selected && state.selected.type === 'node' && (HydModel.nodeById(hyd(), state.selected.id) || {}).kind === 'meter';
        var lay = el.parentNode;
        if (lay) lay.classList.toggle('wide', !!wide);
        el.innerHTML = inspector();
    }

    function inspector() {
        var s = state.selected;
        var res = result();

        if (state.wizardOpen) return wizard();
        if (!s) return overview(res);

        if (s.type === 'multi') return multiInspector(s, res);
        if (s.type === 'node') return nodeInspector(HydModel.nodeById(hyd(), s.id), res);
        if (s.type === 'pipe') return pipeInspector(s.id, res);
        if (s.type === 'floor') return floorInspector(s, res);
        return overview(res);
    }

    /*
        Отметки этажей стояка. Каждая правка — «последняя главнее»: высота этажа f задаёт отметку
        этажа f+1 (прямо вписанная отметка этажа f+1 при этом снимается), а вписанная отметка
        этажа f (кроме первого) определяет высоту этажа f−1.
    */
    function r3(x) { return Math.round(x * 1000) / 1000; }

    function setLevel(n, f, v) {
        if (f === 1) { n.level1 = v; return; }
        n.elevs[f] = v;
        delete n.heights[f - 1];
    }

    function setHeight(n, f, v) {
        delete n.elevs[f + 1];
        if (v > 0) n.heights[f] = v; else delete n.heights[f];
    }

    /* Два поля этажа f: отметка пола и высота. Возвращают HTML; bare — для ячеек таблицы. */
    function floorLevelInputs(n, f, bare) {
        var lv = HydModel.levels(hyd(), n);
        var pe = { v: r3(lv[f]) };
        var ph = { v: r3(lv[f + 1] - lv[f]) };
        return [
            UiHyd.inp(bare ? '' : 'Отметка пола этажа ' + f + ', м', pe, 'v', { bare: bare, w: bare ? '78px' : undefined, after: function (v) { setLevel(n, f, v); } }),
            UiHyd.inp(bare ? '' : 'Высота этажа ' + f + ', м', ph, 'v', { bare: bare, min: 0, w: bare ? '62px' : undefined, after: function (v) { setHeight(n, f, v); } })
        ];
    }

    /*
        Отдельное задание на ИТП. Галочка нумерует ИТП (следующий свободный номер, его можно поменять): ИТП с номером
        считается и выдаётся отдельным заданием, ИТП без номера вместе — одна общая. Одинаковый номер у двух ИТП —
        это одна ИТП из двух узлов на схеме.
    */
    function itpNumbering(n) {
        var d = hyd();
        var proxy = { sep: n.itpNo > 0, no: n.itpNo > 0 ? n.itpNo : 1 };
        var out = [UiHyd.inp('Отдельное задание на эту ИТП', proxy, 'sep', { type: 'chk', struct: true, after: function (v) {
            if (!v) { n.itpNo = 0; return; }
            var used = d.canvas.nodes.filter(function (x) { return x.kind === 'itp' && x !== n && x.itpNo > 0; }).map(function (x) { return x.itpNo; });
            var no = 1;
            while (used.indexOf(no) >= 0) no++;
            n.itpNo = no;
        } })];

        if (n.itpNo > 0) out.push(UiHyd.inp('Номер ИТП', proxy, 'no', { type: 'int', min: 1, struct: true, after: function (v) { n.itpNo = Math.max(1, v); } }));
        out.push('<p class="note">'
            + (n.itpNo > 0 ? 'ИТП ' + n.itpNo + ': своё задание и своя нагрузка; в Excel — отдельный лист и сводка «Итого по комплексу».'
                : 'Без номера: все ИТП без номера считаются одной общей ИТП (одно задание на здание).') + '</p>');
        return out.join('');
    }

    function levelsBlock(n) {
        var d = hyd();
        var lv = HydModel.levels(d, n);
        var h = ['<h4>Отметки этажей</h4>'];
        var changed = n.level1 !== null || Object.keys(n.heights).length || Object.keys(n.elevs).length;

        h.push('<p class="hint">У каждого стояка свои. Впишите отметку пола 1 этажа и высоты этажей, которые отличаются (1-го, 2-го, 3-го …) — остальные берутся из типовой высоты. '
            + 'Можно вписать и отметку пола любого этажа: высота нижнего этажа получится из разницы. Отсюда считаются длины звеньев стояка, статика, напоры и отметки приборов.</p>');
        h.push('<div class="scroll" style="max-height:320px"><table class="grid"><thead><tr><th>Этаж</th><th>Отметка пола, м</th><th>Высота, м</th><th></th></tr></thead><tbody>');

        for (var f = 1; f <= n.floorTo; f++) {
            var inputs = floorLevelInputs(n, f, true);
            var mark = (f === 1 && n.level1 !== null) || n.elevs[f] !== undefined || n.heights[f] > 0 ? ' *' : '';
            h.push('<tr' + (f < n.floorFrom ? ' class="dim"' : '') + '><td>' + f + (f < n.floorFrom ? ' (транзит)' : '') + '</td><td>' + inputs[0] + '</td><td>' + inputs[1] + '</td><td class="note">' + mark + '</td></tr>');
        }

        var gap = lv[1] - n.baseElev;
        h.push('</tbody></table></div>');
        h.push('<p class="' + (gap < 0 || gap > 15 ? 'st-bad' : 'note') + '">От низа стояка (' + num(n.baseElev, 2) + ' м) до пола 1 этажа: <b>' + num(gap, 2)
            + ' м</b> — это длина первого звена стояка' + (gap < 0 || gap > 15 ? '. Проверьте отметку низа стояка: она должна быть в тех же отметках, что и этажи.' : '.') + '</p>');
        h.push('<p class="note">Верх последнего этажа: ' + num(lv[n.floorTo + 1], 3) + ' м. * — задано вручную, остальные по типовой высоте ' + num(HydModel.floorH(d, n), 2) + ' м.</p>');
        h.push('<div class="row cv-actions">' + (changed ? btn('Типовые отметки', 'resetLevels', n.id) : '') + btn('Применить ко всем стоякам', 'levelsAll', n.id) + '</div>');
        return h.join('');
    }

    /* Нижний и верхний приборы стояка: отметки и этажи — по расчётным листьям сети. */
    function riserSpan(res, id) {
        var low = null;
        var high = null;
        if (res && res.net) res.net.leaves.forEach(function (lf) {
            if (lf.riser !== id) return;
            if (!low || lf.elev < low.elev) low = lf;
            if (!high || lf.elev > high.elev) high = lf;
        });
        return { low: low, high: high };
    }

    function elevText(lf) { return lf ? '<b>' + num(lf.elev, 3) + ' м</b> (этаж ' + lf.floor + (lf.label ? ', ' + esc(lf.label) : '') + ')' : '—'; }

    /*
        Группа стояков: поля применяются сразу ко всем выбранным. Таблица сверху показывает, что сейчас
        у каждого: этажи, отметка низа и отметки нижнего и верхнего приборов.
    */
    function riserGroup(risers, res) {
        var d = hyd();
        var first = risers[0];
        var g = { norm: first.norm, baseElev: first.baseElev, floorFrom: first.floorFrom, floorTo: first.floorTo, floorH: first.floorH, typeAll: first.ranges[0] ? first.ranges[0].typeId : '' };
        var each = function (fn) { return function (v) { risers.forEach(function (r) { fn(r, v); }); }; };
        var h = ['<h4>Группа стояков: ' + risers.length + '</h4><table class="grid"><thead><tr><th class="left">Стояк</th><th>Этажи</th><th>Низ, м</th><th>Нижний прибор, м</th><th>Верхний прибор, м</th></tr></thead><tbody>'];

        risers.forEach(function (r) {
            var ex = res && res.ex ? res.ex.risers.filter(function (x) { return x.node.id === r.id; })[0] : null;
            var sp = riserSpan(res, r.id);
            h.push('<tr><td class="left">' + esc(ex ? ex.markC : r.name || r.id) + '</td><td>' + r.floorFrom + '–' + r.floorTo + '</td><td>' + num(r.baseElev, 2) + '</td>'
                + '<td>' + (sp.low ? num(sp.low.elev, 3) : '—') + '</td><td><b>' + (sp.high ? num(sp.high.elev, 3) : '—') + '</b></td></tr>');
        });

        h.push('</tbody></table><p class="hint">Менять можно сразу у всех выбранных:</p><div class="form">');
        h.push(UiHyd.inp('Норма (СП 30, табл. А.2)', g, 'norm', { type: 'select', options: Tables.norms().map(function (x) { return [x.name, x.name]; }), after: each(function (r, v) { r.norm = v; }) }));
        h.push(UiHyd.inp('Отметка низа стояка, м', g, 'baseElev', { after: each(function (r, v) { r.baseElev = v; }) }));
        h.push(UiHyd.inp('Первый этаж с выходами', g, 'floorFrom', { type: 'int', min: 1, after: each(function (r, v) { r.floorFrom = v; if (r.floorTo < v) r.floorTo = v; }) }));
        h.push(UiHyd.inp('Последний этаж', g, 'floorTo', { type: 'int', min: 1, after: each(function (r, v) { r.floorTo = v; if (r.floorFrom > v) r.floorFrom = v; }) }));
        h.push(UiHyd.inp('Типовая высота этажа, м (0 — из опросника)', g, 'floorH', { min: 0, after: each(function (r, v) { r.floorH = v; }) }));
        var lv0 = HydModel.levels(d, first);
        g.level1 = r3(lv0[1]);
        g.h1 = r3(lv0[2] - lv0[1]);
        g.h2 = r3(lv0[3] - lv0[2]);
        g.h3 = r3(lv0[4] - lv0[3]);
        h.push(UiHyd.inp('Отметка пола 1 этажа, м', g, 'level1', { after: each(function (r, v) { setLevel(r, 1, v); }) }));
        h.push(UiHyd.inp('Высота 1 этажа, м', g, 'h1', { min: 0, after: each(function (r, v) { setHeight(r, 1, v); }) }));
        h.push(UiHyd.inp('Высота 2 этажа, м', g, 'h2', { min: 0, after: each(function (r, v) { setHeight(r, 2, v); }) }));
        h.push(UiHyd.inp('Высота 3 этажа, м', g, 'h3', { min: 0, after: each(function (r, v) { setHeight(r, 3, v); }) }));
        h.push(UiHyd.inp('Один тип на все этажи', g, 'typeAll', {
            type: 'select', options: UiHyd.typeOptions(true), struct: true,
            after: each(function (r, v) { if (v) { r.ranges = [{ from: r.floorFrom, to: r.floorTo, typeId: v }]; r.exceptions = []; } })
        }));
        h.push('</div><div class="row cv-actions">' + btn('Типовые отметки у выбранных', 'resetLevelsGroup', '') + '</div>');
        return h.join('');
    }

    function multiInspector(s, res) {
        var nodes = s.ids.map(function (id) { return HydModel.nodeById(hyd(), id); }).filter(Boolean);
        var risers = nodes.filter(function (n) { return n.kind === 'riser'; });

        return '<div class="ctitle"><b>Выбрано объектов: ' + s.ids.length + '</b></div>'
            + (risers.length ? riserGroup(risers, res) : '')
            + '<p class="note">Тяните любой из выбранных — переедут все, трубы между ними сохранят форму. Shift + щелчок добавляет или убирает объект. Рамка слева направо берёт объекты целиком, справа налево — всё, что она задела.</p>'
            + '<div class="row cv-actions">' + btn('Удалить выбранные', 'delMulti', '', 'danger') + btn('Снять выделение', 'clearSel', '') + '</div>';
    }

    function wizard() {
        var w = state.wizard;
        return '<h3>Стартовая схема</h3><p class="hint">Заготовка: ввод → счётчик → насосная → магистраль с ответвлениями на стояки → ИТП, ГВС копией трассы. '
            + 'Дальше всё правится мышью.</p><div class="form">'
            + UiHyd.inp('Секций', w, 'sections', { type: 'int', min: 1 })
            + UiHyd.inp('Стояков в секции', w, 'risers', { type: 'int', min: 1 })
            + UiHyd.inp('Этажей всего', w, 'floors', { type: 'int', min: 1 })
            + UiHyd.inp('Зон водоснабжения (насосных установок)', w, 'zones', { type: 'int', min: 1, max: 4 })
            + '</div><button type="button" class="primary" data-sv="build">Построить</button> '
            + '<button type="button" data-sv="wizard">Отмена</button>';
    }

    function overview(res) {
        var h = [];
        h.push('<h3>Как рисовать</h3><ol class="cv-help">'
            + '<li><b>Ввод</b>, <b>Насосная</b>, <b>Счётчик</b> (клик по трубе — вставка в разрыв), <b>ИТП</b>, <b>Встроенное</b>, <b>Стояк</b> — ставьте из панели.</li>'
            + '<li><b>Труба</b>: клик по объекту или трубе, затем клики по пустому месту (изгибы), последний клик — по объекту.</li>'
            + '<li>Щёлкните по объекту — справа его параметры. По стояку — этажи и типы этажей; по узлу «кв. 1–4» — этаж стояка.</li>'
            + '<li>Лист <b>ГВС</b>: кнопка «ГВС по трассе ХВС», дальше правится отдельно.</li>'
            + '<li>Колесо — масштаб, средняя кнопка или Пробел+тяга — сдвиг. Esc — отмена, Delete — удалить выбранное.</li></ol>');

        if (res && res.systems.length) {
            h.push('<h3>Насосные установки</h3><table class="grid"><thead><tr><th class="left">Система</th><th>Q, л/с</th><th>H, м</th><th>Прибор низ, м</th><th>Прибор верх, м</th></tr></thead><tbody>');
            res.systems.forEach(function (s) {
                h.push('<tr><td class="left">' + esc(s.name) + '</td><td>' + num(s.pump ? s.pump.q : 0, 3) + '</td><td>'
                    + (s.pump && s.pump.pumped ? '<b>' + num(s.pump.hp, 1) + '</b>' : 'сеть') + '</td>'
                    + '<td>' + (s.span && s.span.low ? num(s.span.low.elev, 2) : '—') + '</td><td>' + (s.span && s.span.high ? '<b>' + num(s.span.high.elev, 2) + '</b>' : '—') + '</td></tr>');
            });
            h.push('</tbody></table>');
        }

        return h.join('');
    }

    function btn(text, act, arg, cls) {
        return '<button type="button" class="small ' + (cls || '') + '" data-sv="' + act + '" data-arg="' + esc(arg) + '">' + text + '</button>';
    }

    /*
        Панель водомерного узла — подбор счётчика, как в приложении «Подбор счётчиков»:
        расход из сети (или свой), тип, метод потерь, все калибры с потерями по
        паспорту и по СП, статус и рекомендуемый; щелчок по строке выбирает калибр.
    */
    function meterPanel(n, res) {
        var d = hyd();
        var net = state.net;
        var hot = net === 'h';
        var seg = res && res.net ? res.net.byId[net + '|dev:' + n.id] : null;
        var qNet = seg ? seg.res.q : 0;
        var q = n.qOver > 0 ? n.qOver : qNet;
        var opts = HydCalc.meterOpts(d.survey, n);
        var method = opts.method;
        var h = [];

        h.push(UiHyd.inp('Где стоит', n, 'role', { type: 'select', options: [['main', 'на вводе'], ['section', 'на секции / ответвлении'], ['builtin', 'на встроенном помещении']] }));
        h.push(UiHyd.inp('Место установки', n, 'place', { type: 'text', ph: 'Секция 1, подвал' }));
        h.push(UiHyd.inp('Система', n, 'systemName', { type: 'text', list: 'cvSystems', ph: hot ? 'Горячее водоснабжение' : 'Холодное водоснабжение' }));
        h.push('<datalist id="cvSystems">' + HydMeter.SYSTEMS.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>');
        h.push(UiHyd.inp('Расход, л/с (0 — по расчёту сети: ' + num(qNet, 3) + ')', n, 'qOver', { min: 0 }));
        h.push(UiHyd.inp('Тип счётчика', n, 'kindFilter', { type: 'select', options: [['', 'Авто (крыльчатый, затем турбинный)'], ['vane', 'Крыльчатый'], ['turbine', 'Турбинный']] }));
        h.push(UiHyd.inp('Потери в расчёт принимать', n, 'method', { type: 'select', options: [['', 'как в проекте (' + (d.survey.meter.method === 'passport' ? 'по паспорту' : 'по СП') + ')'], ['sp', 'по СП 30.13330 (S·q²)'], ['passport', 'по паспорту завода']] }));
        h.push(UiHyd.inp('Примечание', n, 'note', { type: 'text', ph: method === 'sp' ? HydMeter.SP_NOTE : '' }));

        h.push('<p class="note">Среда: ' + (hot ? 'горячая вода (ВСГН)' : 'холодная вода (ВСХН)') + '. Фильтр добавляет ' + num(d.survey.hFilter, 2) + ' м к потерям в расчёте напоров.</p>');

        h.push('<details class="cv-set"><summary>Настройки подбора для всего проекта</summary><div class="form">'
            + UiHyd.inp('Предел потерь крыльчатых, м', d.survey.meter, 'limitVane', { min: 0.1 })
            + UiHyd.inp('Предел потерь турбинных, м', d.survey.meter, 'limitTurbine', { min: 0.1 })
            + UiHyd.inp('Класс точности', d.survey.meter, 'cls', { type: 'select', numeric: true, options: [[0, 'A'], [1, 'B'], [2, 'C']] })
            + UiHyd.inp('Метод потерь по умолчанию', d.survey.meter, 'method', { type: 'select', options: [['sp', 'по СП 30.13330'], ['passport', 'по паспорту завода']] })
            + UiHyd.inp('Импульсный выход (суффикс «д»)', d.survey.meter, 'pulse', { type: 'chk' })
            + '</div></details>');

        if (!(q > 0)) {
            h.push('<p class="verdict unknown">Расхода нет: счётчик не подключён к сети или за ним нет нагрузки. Задайте расход вручную выше или соедините трубами.</p>');
            return h.join('');
        }

        var info = HydMeter.pick(q, hot, opts, { kind: n.kindFilter, chosen: n.chosen });
        var list = info.list;
        var rec = info.recommended;
        var cur = info.c;

        // сводка
        var head = 'Q = ' + num(q * 3.6, 2) + ' м³/ч. ';
        if (!rec) h.push('<p class="verdict fail">' + head + 'Подходящего калибра нет — проверьте расход и тип счётчика.</p>');
        else if (rec.suitable) h.push('<p class="verdict pass">' + head + 'Рекомендуется <b>' + esc(rec.markFull) + '</b> (' + rec.kindName + '): потери ' + num(rec.h, 2) + ' м при пределе ' + num(rec.limit, 1) + ' м.</p>');
        else h.push('<p class="verdict fail">' + head + 'По пределу потерь не проходит ни один калибр; наименьшие потери у ' + esc(rec.markFull) + ' — ' + num(rec.h, 2) + ' м.</p>');

        if (n.chosen && cur) {
            h.push('<p class="note">Выбран вручную: <b>' + esc(cur.markFull) + '</b>, потери ' + num(cur.h, 2) + ' м — ' + esc(cur.status) + '. <button type="button" class="small" data-sv="autoMeter" data-arg="' + esc(n.id) + '">Вернуть автоподбор</button></p>');
        }

        h.push('<div class="scroll"><table class="cv-cand"><thead><tr><th class="left">Марка</th><th>DN</th><th class="left">Тип</th><th>h пасп., м</th><th>h СП, м</th><th>Пред., м</th><th>Q, м³/ч</th><th>Диапазон</th><th class="left">Статус</th></tr></thead><tbody>');

        list.forEach(function (c) {
            var chosen = cur && c.dn === cur.dn && c.kind === cur.kind && (c.variant || '') === (cur.variant || '');
            var st = c.status;
            var stCls = st === 'подходит' ? 'st-ok' : (st === 'потери выше предела' || st === 'расход выше Qmax' ? 'st-bad' : 'st-warn');
            var over = c.hasLoss && !c.lossOk;
            h.push('<tr data-sv="pickMeter" data-arg="' + esc(c.dn + '|' + c.kind + '|' + (c.variant || '')) + '" class="' + (chosen ? 'here' : '') + (c.flowOk ? '' : ' dim') + '" style="cursor:pointer">'
                + '<td class="left">' + esc(c.markFull) + (rec && c === rec ? ' ★' : '') + '</td><td>' + c.dn + '</td><td class="left">' + c.kindName + '</td>'
                + '<td class="' + (method === 'passport' ? 'act' : '') + (over && method === 'passport' ? ' over' : '') + '">' + num(c.hPassport, 2) + '</td>'
                + '<td class="' + (method === 'sp' ? 'act' : '') + (over && method === 'sp' ? ' over' : '') + '">' + (c.hasSp ? num(c.hSp, 2) : '—') + '</td>'
                + '<td>' + HydMeter.coef(c.limit) + '</td><td>' + num(c.qM3h, 2) + '</td>'
                + '<td>' + (c.qmin === null || !isFinite(c.qmin) ? '—' : HydMeter.coef(c.qmin)) + ' … ' + HydMeter.coef(c.qmax) + '</td>'
                + '<td class="left ' + stCls + '">' + esc(st) + '</td></tr>');
        });

        h.push('</tbody></table></div><p class="note">★ — рекомендуемый (наименьший калибр, проходящий и по потерям, и по диапазону). Щёлкните по строке, чтобы взять другой калибр.</p>');
        return h.join('');
    }

    function nodeInspector(n, res) {
        if (!n) return overview(res);
        var h = [];
        var d = hyd();
        var net = state.net;
        var byId = res && res.net ? res.net.byId : {};

        h.push('<div class="ctitle"><b>' + esc(KINDS[n.kind]) + '</b><span class="badge">' + esc(n.id) + '</span></div>');
        h.push('<div class="form">');

        if (n.kind === 'input') {
            h.push(UiHyd.inp('Название', n, 'name', { type: 'text' }));
            h.push(UiHyd.inp('Гарантированный напор Hгар, м', n, 'Hgar', { min: 0 }));
            h.push(UiHyd.inp('Потери во вводе Hв, м', n, 'hv', { min: 0 }));
            h.push(UiHyd.inp('Отметка оси ввода, м', n, 'elev'));
            h.push(UiHyd.inp('Длина ввода до здания, м', n, 'length', { min: 0 }));
            h.push(UiHyd.inp('Материал', n, 'material', {
                type: 'select', options: HydData.MATERIALS.map(function (m) { return [m.key, m.name]; }),
                after: function (v) {
                    var list = HydData.sizesOf(v);
                    var f = list[Math.min(list.length - 1, 6)];
                    n.od = f.od;
                    n.wall = f.wall;
                }
            }));
            var proxy = { v: n.od + '|' + n.wall };
            h.push(UiHyd.inp('Диаметр ввода', proxy, 'v', {
                type: 'select', options: HydData.sizesOf(n.material).map(function (z) { return [z.od + '|' + z.wall, z.label]; }),
                after: function (v) { var p = v.split('|'); n.od = parseFloat(p[0]); n.wall = parseFloat(p[1]); }
            }));
            var s0 = byId['c|in'];
            if (s0 && s0.res.size) h.push('<p class="note">q = ' + num(s0.res.q, 3) + ' л/с, V = ' + num(s0.res.size.v, 2) + ' м/с, i = ' + num(s0.res.size.iMm, 2) + ' мм/м</p>');
        } else if (n.kind === 'meter') {
            h.push(meterPanel(n, res));
        } else if (n.kind === 'pump') {
            h.push(UiHyd.inp('Название (зона)', n, 'name', { type: 'text' }));
            h.push(UiHyd.inp('Отметка оси насосов, м', n, 'elev'));
            h.push(UiHyd.inp('Рабочих насосов', n, 'work', { type: 'int', min: 1 }));
            h.push(UiHyd.inp('Резервных насосов', n, 'reserve', { type: 'int', min: 0 }));
            var sys = res ? res.systems.filter(function (x) { return x.id === n.id; })[0] : null;
            if (sys && sys.pump) {
                h.push('<p class="note">Qтр = <b>' + num(sys.pump.q, 3) + ' л/с</b> (' + num(sys.pump.qM3h, 2) + ' м³/ч), Hтр = <b>' + num(sys.pump.hp, 1)
                    + ' м</b>. Диктующий прибор: ' + esc(sys.dict.leaf.label) + ' (' + (sys.dict.leaf.net === 'c' ? 'ХВС' : 'ГВС') + '). Подробно — вкладка «Напоры».</p>');
                var psel = (hyd().pumpSel || {})[n.id];
                h.push('<p class="note">' + (psel && psel.name ? 'Подобрано: <b>' + esc(psel.name) + '</b>' + (psel.Qf !== null && psel.Hf !== null ? ', Qф = ' + num(psel.Qf, 2) + ' л/с, Hф = ' + num(psel.Hf, 1) + ' м' : '') + (psel.sheet ? ' (лист ' + esc(psel.sheet) + ')' : '') : 'Насос по каталогу не подобран.') + '</p>'
                    + '<button type="button" class="small" data-act="pumpSheet" data-arg="' + esc(n.id) + '">' + (psel && psel.name ? 'Заменить каталожный лист…' : 'Загрузить каталожный лист…') + '</button>');
            } else {
                h.push('<p class="note">За этой насосной нет приборов — соедините трубой со стояками.</p>');
            }
        } else if (n.kind === 'itp') {
            h.push(UiHyd.inp('Название', n, 'name', { type: 'text' }));
            h.push(itpNumbering(n));
            h.push('<p class="note">Холодная вода подаётся на лист ХВС (канал «горячий»), а сеть ГВС начинается на листе ГВС от этого же объекта.</p>');
        } else if (n.kind === 'tee') {
            h.push('<p class="note">Узел ветвления. Тяните за него — трубы следуют.</p>');
        } else if (n.kind === 'buildin') {
            h.push(UiHyd.inp('Название', n, 'name', { type: 'text' }));
            h.push(UiHyd.inp('Норма потребления (СП 30, табл. А.2)', n, 'norm', { type: 'select', options: Tables.norms().map(function (x) { return [x.name, x.name]; }) }));
            h.push(UiHyd.inp('Людей (потребителей)', n, 'U', { type: 'int', min: 0 }));
            h.push(UiHyd.inp('Приборов (0 — по людям)', n, 'N', { type: 'int', min: 0 }));
            h.push(UiHyd.inp('из них с ГВС', n, 'Nh', { type: 'int', min: 0 }));
            h.push(UiHyd.inp('Отметка пола, м', n, 'elev'));
            h.push('</div><div class="row">' + UiHyd.inp('Горячая вода есть', n, 'hasHot', { type: 'chk' }));
        } else if (n.kind === 'riser') {
            h.push(riserFields(n, res));
        }

        h.push('</div>');
h.push('<div class="row cv-actions">' + (n.kind === 'meter' ? btn('Повернуть (R)', 'rotMeter', n.id) : '') + btn('Удалить', 'delNode', n.id, 'danger') + (n.kind === 'riser' ? btn('Дублировать блок', 'dupRiser', n.id) : '') + '</div>');
        return h.join('');
    }

    function riserFields(n, res) {
        var d = hyd();
        var h = [];
        var ex = res && res.ex ? res.ex.risers.filter(function (r) { return r.node.id === n.id; })[0] : null;
        var tot = HydModel.riserTotals(d, n);

        h.push(UiHyd.inp('Название', n, 'name', { type: 'text', ph: ex ? ex.markC : '' }));
        h.push(UiHyd.inp('Норма (СП 30, табл. А.2)', n, 'norm', { type: 'select', options: Tables.norms().map(function (x) { return [x.name, x.name]; }) }));
        h.push(UiHyd.inp('Отметка низа стояка, м', n, 'baseElev'));
        h.push(UiHyd.inp('Первый этаж с выходами', n, 'floorFrom', { type: 'int', min: 1, after: function () { if (n.floorTo < n.floorFrom) n.floorTo = n.floorFrom; } }));
        h.push(UiHyd.inp('Последний этаж', n, 'floorTo', { type: 'int', min: 1, after: function () { if (n.floorFrom > n.floorTo) n.floorFrom = n.floorTo; } }));
        h.push(UiHyd.inp('Типовая высота этажа, м (0 — из опросника)', n, 'floorH', { min: 0 }));
        h.push(UiHyd.inp('Номер первой квартиры (0 — по порядку)', n, 'firstNumber', { type: 'int', min: 0 }));
        var sp = riserSpan(res, n.id);
        h.push('</div><p class="note">Выходов: ' + tot.outlets + ', людей: ' + tot.people + '. Этажи ниже первого — транзит трубы без выходов.</p>');
        h.push('<p class="note">Нижний прибор: ' + elevText(sp.low) + '<br>Верхний прибор: ' + elevText(sp.high) + '</p>');
        h.push('<p class="note">Чтобы поменять сразу несколько стояков (этажи, отметку низа, тип этажей), выделите их рамкой — справа появится форма для всей группы.</p>');

        h.push('<h4>Типы этажей</h4><table class="form"><thead><tr><th>С</th><th>По</th><th class="left">Тип этажа</th><th></th></tr></thead><tbody>');

        n.ranges.forEach(function (r, i) {
            h.push('<tr><td>' + UiHyd.inp('', r, 'from', { type: 'int', min: 1, bare: true }) + '</td><td>' + UiHyd.inp('', r, 'to', { type: 'int', min: 1, bare: true }) + '</td>'
                + '<td class="left">' + UiHyd.inp('', r, 'typeId', { type: 'select', options: UiHyd.typeOptions(true), bare: true }) + '</td>'
                + '<td>' + btn('×', 'delRange', n.id + ':' + i, 'danger mini') + '</td></tr>');
        });

        n.exceptions.forEach(function (x, i) {
            h.push('<tr class="group"><td>этаж</td><td>' + UiHyd.inp('', x, 'floor', { type: 'int', min: 1, bare: true }) + '</td>'
                + '<td class="left">' + UiHyd.inp('', x, 'typeId', { type: 'select', options: UiHyd.typeOptions(true), bare: true }) + '</td>'
                + '<td>' + btn('×', 'delExc', n.id + ':' + i, 'danger mini') + '</td></tr>');
        });

        h.push('</tbody></table><div class="row">' + btn('+ диапазон этажей', 'addRange', n.id) + btn('+ исключение (один этаж)', 'addExc', n.id)
            + btn('Этажная разводка →', 'openFloors', (n.ranges[0] ? n.ranges[0].typeId : '') + '|') + '</div>');

        h.push(levelsBlock(n));

        var first = res && res.net ? res.net.byId[state.net + '|' + n.id + '|R|1'] : null;
        if (first && first.res.size) h.push(UiHydView.segCard(res, first.id, true));
        h.push('<div class="form">');
        return h.join('');
    }

    /* Почему труба не считается: по концам — достигнуты ли они от ввода (ИТП на листе ГВС). */
    function diagnosis(id, res) {
        var d = hyd();
        var sheet = state.net;
        var p = d.canvas.pipes.filter(function (q) { return q.id === id; })[0];
        if (!p || !res || !res.net || !res.net.reached) return '<p class="note">Труба не входит в расчётную сеть.</p>';

        var issue = res.net.pipeIssue[sheet + '|' + id];

        function end(nodeId) {
            var n = HydModel.nodeById(d, nodeId);
            var name = KINDS[n.kind] + (n.name ? ' «' + n.name + '»' : ' ' + n.id);
            var ok = res.net.reached[sheet][nodeId];
            return '<li>' + esc(name) + ' (' + esc(n.id) + '): ' + (ok ? 'связан с ' + (sheet === 'c' ? 'вводом' : 'ИТП') : '<b>не связан</b>')
                + '; труб на этом листе: ' + HydGraph.degreeOn(d, nodeId, sheet) + '</li>';
        }

        var title = { ring: 'Эта труба замыкает кольцо', 'itp-cold': 'ГВС не считается: ИТП не подключена к вводу на листе ХВС', skipped: 'Труба соединена, но расчёт её пропустил' }[issue]
            || 'Эта труба не связана с ' + (sheet === 'c' ? 'вводом' : 'ИТП');
        var out = '<div class="verdict unknown"><b>' + title + '</b>'
            + '<ul style="margin:6px 0 0;padding-left:18px">' + end(p.a) + end(p.b) + '</ul>';

        var twin = issue === 'ring' ? HydGraph.parallelOf(d, p) : null;
        if (twin) out += '<p><b>Дубль:</b> между этими же двумя объектами уже есть труба ' + esc(twin.id) + ' — два соединения образуют кольцо, поэтому одна из них не считается. Удалите лишнюю (кнопка ниже) или «Убрать дубли» — программа оставит первую.</p>';
        if (issue === 'itp-cold') out += '<p>Горячая сеть нарисована верно, но ИТП на листе ХВС не соединена трубой с вводом (через насосную и тройники). Переключитесь на лист ХВС и подведите к ИТП трубу от магистрали: пока ИТП не получает холодную воду, горячая сторона не считается.</p>';
        else if (issue === 'skipped') out += '<p>Труба включена в схему, но участок по ней не построен. Причину смотрите в замечаниях расчёта (вкладка «Участки»/«Напоры»): обычно у объекта на конце нет нагрузки или он не подключён к ИТП/вводу.</p>';
        if (issue === 'ring') out += '<p>Оба конца уже получают воду по другим трубам, поэтому эта труба расчёту не нужна. Удалите её или одну из соседних — кольца не считаются.</p>';
        else if (issue !== 'itp-cold' && issue !== 'skipped') out += '<p>Конец с отметкой «не связан» ни к чему не подключён, кроме этой трубы. Обычно это тройник, оставшийся от неудачной трассировки: удалите его и протяните трубу от порта (кольцо-притяжение должно появиться).</p>';

        return out + '<div class="row cv-actions">' + btn('Убрать все висячие тройники', 'prune', '') + (twin ? btn('Убрать дубли', 'dedupe', '') : '') + '</div></div>';
    }

    function pipeInspector(id, res) {
        var segId = state.net + '|' + id;
        var h = [];

        h.push('<div class="ctitle"><b>Труба</b><span class="badge">' + esc(id) + '</span></div>');

        if (res && res.net && res.net.byId[segId]) h.push(UiHydView.segCard(res, segId, true));
        else h.push(diagnosis(id, res));

        h.push('<p class="note">Двойной щелчок по трубе добавляет излом; вершины тянутся мышью.</p>');
        h.push('<div class="row cv-actions">' + btn('Удалить трубу', 'delPipe', id, 'danger') + '</div>');
        return h.join('');
    }

    function floorInspector(s, res) {
        var d = hyd();
        var riser = HydModel.nodeById(d, s.riser);
        if (!riser) return overview(res);

        var typeId = HydModel.typeOfFloor(riser, s.floor);
        var type = HydModel.typeById(d, typeId);
        var ex = res && res.ex ? res.ex.risers.filter(function (r) { return r.node.id === riser.id; })[0] : null;
        var mark = ex ? ex.markC : riser.id;
        var col = type ? type.collectors.filter(function (c) { return c.id === s.collector; })[0] : null;
        var h = [];

        h.push('<div class="ctitle"><b>Этаж ' + s.floor + ' · стояк ' + esc(mark) + '</b></div>');

        var fb = res && res.net ? res.net.byId[state.net + '|' + s.riser + '/F' + s.floor + '/' + s.collector + '|fb'] : null;
        if (fb && fb.res.press) {
            h.push('<p class="note">Напор у коллектора: <b>' + num(fb.res.press.dyn, 1) + ' м</b> при расчётном расходе, статический ' + num(fb.res.press.stat, 1)
                + ' м. Свободный напор Hпр = ' + num(d.survey.hPr, 0) + ' м, регулятор — выше ' + num(d.survey.staticLimit, 0) + ' м.</p>');
        }


        var lvIn = floorLevelInputs(riser, s.floor, false);
        h.push('<div class="form">' + lvIn[0] + lvIn[1] + '</div>');

        var exc = riser.exceptions.filter(function (x) { return x.floor === s.floor; })[0];
        var proxy = { t: typeId };

        h.push('<div class="form">' + UiHyd.inp('Типовой этаж на этом этаже', proxy, 't', {
            type: 'select', options: UiHyd.typeOptions(true),
            after: function (v) {
                riser.exceptions = riser.exceptions.filter(function (x) { return x.floor !== s.floor; });
                // тот же тип, что по диапазонам, — исключение не нужно
                var base = '';
                riser.ranges.forEach(function (r) { if (s.floor >= r.from && s.floor <= r.to) base = r.typeId; });
                if (v !== base) riser.exceptions.push({ floor: s.floor, typeId: v });
            }
        }) + '</div>');

        if (exc) h.push('<p class="note">Для этого этажа задано исключение из диапазонов стояка.</p>');

        if (col) {
            h.push('<h4>Узел «' + esc(col.name) + '»</h4><table class="form"><thead><tr><th class="left">Выход</th><th>Комнат</th><th>Людей</th></tr></thead><tbody>');
            col.outlets.forEach(function (o) {
                h.push('<tr><td class="left">' + esc(o.label) + (o.count > 1 ? ' ×' + o.count : '') + '</td><td>'
                    + UiHyd.inp('', o, 'rooms', { type: 'select', numeric: true, options: [[0, 'студия'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5+']], bare: true })
                    + '</td><td>' + UiHyd.inp('', o, 'people', { type: 'int', min: 0, bare: true, w: '4em' }) + '</td></tr>');
            });
            h.push('</tbody></table><p class="note">Правка меняет тип «' + esc(type.name) + '» на всех его этажах. Нужно только для этого этажа — '
                + 'сделайте его отдельным типом.</p>');
            h.push('<div class="row cv-actions">' + btn('Отдельный тип для этого этажа', 'sepType', riser.id + '|' + s.floor)
                + btn('Этажная разводка →', 'openFloors', typeId + '|' + col.id) + '</div>');
        } else {
            h.push('<p class="note">На этом этаже выходов нет. Выберите тип этажа выше.</p>');
        }

        return h.join('');
    }

    return { init: init, show: show, redraw: redraw };
})();
