/*
    Вкладка «Гидравлика»: каркас, опросник и этажная разводка.

    Подвкладки: «Схема» (холст — ui-hyd-scheme.js), «Этажная разводка» (типовые
    этажи: коллекторы и выходы-квартиры), «Опросник» (общие параметры), «Участки»
    и «Напоры» (результаты — ui-hyd-view.js).

    Поля связываются с моделью через реестр: при отрисовке каждому полю даётся
    номер, одно общее событие change на контейнере читает значение и кладёт в
    нужное место модели. Так форма не пересобирается на каждую правку (иначе
    теряется фокус при переходе клавишей Tab).
*/

var UiHyd = (function () {
    'use strict';

    var esc = Format.html;
    var body;
    var reg = [];
    var state = {
        sub: 'scheme', typeId: '', focus: '', sysId: '', net: 'c', selected: null, tool: 'select',
        zone: '', points: 'auto', snap: true, ortho: true, view: { x: 40, y: 40, k: 0.8 }, drawing: null, multi: [], showHead: 'dyn', marquee: null, rowKind: 'mains', rowNet: 'all', fitted: false
    };
    var result = null;
    var dirty = true;

    function hyd() { return App.project.hyd; }

    function init() {
        var root = document.getElementById('tab-hyd');

        root.innerHTML =
            '<div class="card no-print">'
            + '<div class="ctitle"><b>Гидравлика ХВС и ГВС</b><span id="hydInfo" class="badge"></span></div>'
            + '<div class="row">'
            + '<label class="field chk"><input type="checkbox" id="hydMethod"> Вероятность по приборам '
            + '(одна P на систему; снимите галочку — по людям)</label>'
            + '<button type="button" id="hydUndo" class="small" title="Отменить последнее действие (Ctrl+Z)">↶ Отменить</button>'
            + '<button type="button" id="hydRedo" class="small" title="Вернуть отменённое (Ctrl+Y или Ctrl+Shift+Z)">↷ Вернуть</button>'
            + '<button type="button" id="hydNote" class="small" title="Текстовая часть записки ИОС2 «Водоснабжение» в Word: разделы А–Т7, таблицы, приложения с расчётом напоров">Записка ИОС2 (Word)</button>'
            + '<span id="hydHist" class="note"></span>'
            + '</div>'
            + '<div class="subtabs" id="hydSubs"></div>'
            + '</div>'
            + '<div id="hydBody"></div>';

        body = document.getElementById('hydBody');

        document.getElementById('hydUndo').addEventListener('click', undo);
        document.getElementById('hydRedo').addEventListener('click', redo);
        document.getElementById('hydNote').addEventListener('click', function () {
            var t = document.getElementById('hydHist');
            try {
                if (dirty) compute();
                var out = HydNote.save(App.project, result, hyd());
                t.textContent = 'Записка выгружена в Word; помечено жёлтым: ' + out.marks + ' мест — заполнить или проверить';
            } catch (error) {
                t.textContent = 'Записка не выгружена: ' + error.message;
                console.error(error);
            }
        });

        window.addEventListener('keydown', function (e) {
            if (!isActive() || !(e.ctrlKey || e.metaKey)) return;
            if (/INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || '') && document.activeElement.type !== 'checkbox') return;

            if (e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); undo(); }
            else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) { e.preventDefault(); redo(); }
        });

        document.getElementById('hydMethod').addEventListener('change', function (e) {
            hyd().method = e.target.checked ? 'fixtures' : 'people';
            changed(true);
        });

        var subs = [['scheme', 'Схема'], ['floors', 'Этажная разводка'], ['survey', 'Опросник'], ['rows', 'Участки'], ['meters', 'Счётчики'], ['pumps', 'Насосы'], ['note', 'Данные записки'], ['preview', 'Просмотр записки'], ['itp', 'Задание в ИТП'], ['elss', 'Задание ЭЛ и СС'], ['heads', 'Напоры']];
        document.getElementById('hydSubs').innerHTML = subs.map(function (s) {
            return '<button type="button" data-sub="' + s[0] + '">' + s[1] + '</button>';
        }).join('');

        document.getElementById('hydSubs').addEventListener('click', function (e) {
            var s = e.target.getAttribute('data-sub');
            if (!s) return;
            state.sub = s;
            renderBody();
        });

        body.addEventListener('change', onChange);
        body.addEventListener('click', onClick);

        UiHydView.init(body, state, reg);
        UiHydPumps.init(body, state, reg);
        UiHydRequest.init();
        UiHydNote.init(body, state, reg);
        UiHydPreview.init(body, state);
        UiHydItp.init(body, state, reg);
        UiHydElss.init(body, state, reg);
        UiHydScheme.init(body, state, reg);
    }

    function render() {
        var m = document.getElementById('hydMethod');
        if (m) m.checked = hyd().method === 'fixtures';
        dirty = true;
        state.selected = null;
        state.drawing = null;
        state.fitted = false;
        history.reset();
        if (isActive()) renderBody();
    }

    function isActive() {
        var t = document.getElementById('tab-hyd');
        return t && t.classList.contains('active');
    }

    /* Вызывается из App.run(): расчёт — только когда вкладка открыта, иначе при показе. */
    function run(node) {
        dirty = true;
        state.node = node;
        if (isActive()) compute();
    }

    function onShow() {
        if (dirty) compute();
        renderBody();
    }

    function compute() {
        try {
            result = HydCalc.run(hyd(), state.node);
            dirty = false;
        } catch (error) {
            result = null;
            body.innerHTML = '<div class="card"><div class="verdict fail"><b>Ошибка расчёта:</b> ' + esc(error.message) + '</div></div>';
            console.error(error);
            return;
        }

        info();
    }

    function info() {
        var el = document.getElementById('hydInfo');
        if (!el || !result) return;

        var parts = [];
        parts.push(result.people + ' чел.');
        if (result.input && result.input.q > 0) parts.push('ввод ' + Format.num(result.input.q, 3) + ' л/с');

        result.systems.forEach(function (s) {
            if (s.pump) parts.push(s.name + ': ' + (s.pump.pumped ? 'H=' + Format.num(s.pump.hp, 1) + ' м' : 'без насоса'));
        });

        el.textContent = parts.join(' · ');
    }

    function renderBody() {
        if (dirty) compute();

        var buttons = document.querySelectorAll('#hydSubs button');
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].classList.toggle('on', buttons[i].getAttribute('data-sub') === state.sub);
        }

        reg.length = 0;

        if (state.sub === 'survey') body.innerHTML = survey();
        else if (state.sub === 'floors') { body.innerHTML = floors(); focusCollector(); }
        else if (state.sub === 'scheme') UiHydScheme.show(result);
        else if (state.sub === 'pumps') UiHydPumps.show(result);
        else if (state.sub === 'note') UiHydNote.show(result);
        else if (state.sub === 'preview') UiHydPreview.show(result);
        else if (state.sub === 'itp') UiHydItp.show(result);
        else if (state.sub === 'elss') UiHydElss.show(result);
        else UiHydView.show(state.sub, result);
    }

    /*
        История правок: после каждого изменения модели запоминается её полный снимок
        (JSON). Отмена и возврат подменяют project.hyd снимком и перерисовывают всё.
        Хранится до 80 шагов; размер снимка — десятки килобайт.
    */
    var history = {
        stack: [],
        at: -1,
        limit: 80,

        snap: function () { return JSON.stringify(hyd()); },

        reset: function () {
            this.stack = [this.snap()];
            this.at = 0;
            this.buttons();
        },

        push: function () {
            if (!this.stack.length) { this.reset(); return; }
            var s = this.snap();
            if (this.stack[this.at] === s) return;
            this.stack.length = this.at + 1;
            this.stack.push(s);
            if (this.stack.length > this.limit) this.stack.shift();
            this.at = this.stack.length - 1;
            this.buttons();
        },

        buttons: function () {
            var u = document.getElementById('hydUndo');
            var r = document.getElementById('hydRedo');
            if (u) u.disabled = this.at <= 0;
            if (r) r.disabled = this.at >= this.stack.length - 1;
            var t = document.getElementById('hydHist');
            if (t) t.textContent = this.stack.length > 1 ? 'шаг ' + (this.at + 1) + ' из ' + this.stack.length : '';
        }
    };

    function restore(index) {
        if (index < 0 || index >= history.stack.length) return;
        history.at = index;
        App.project.hyd = HydModel.normalize(JSON.parse(history.stack[index]));
        state.selected = null;
        state.multi = [];
        state.drawing = null;
        state.hover = null;
        state.marquee = null;

        var m = document.getElementById('hydMethod');
        if (m) m.checked = hyd().method === 'fixtures';

        App.run();
        dirty = true;
        renderBody();
        history.buttons();
    }

    function undo() { if (history.at > 0) restore(history.at - 1); }
    function redo() { if (history.at < history.stack.length - 1) restore(history.at + 1); }

    /* Любая правка модели: пересчёт и перерисовка текущей подвкладки. */
    function changed(structural) {
        App.run();
        history.push();

        if (state.sub === 'scheme') UiHydScheme.redraw(result);
        else if (state.sub === 'note' && !structural) UiHydNote.refresh(result);
        else if (state.sub === 'itp' && !structural) UiHydItp.refresh(result);
        else if (state.sub === 'elss' && !structural) UiHydElss.refresh(result);
        else if (structural || (state.sub !== 'survey' && state.sub !== 'floors')) renderBody();
    }

    /* --- связывание полей ---------------------------------------------------- */

    function bind(obj, key, o) { reg.push({ obj: obj, key: key, o: o || {} }); return reg.length - 1; }

    /*
        Поле ввода. o.type: 'num' (по умолчанию), 'int', 'text', 'select', 'chk';
        o.options — для select [[значение, подпись], …]; o.min/o.max; o.bare — без
        подписи (в ячейке таблицы); o.after — вызвать после записи; o.struct — пересобрать форму.
    */
    function inp(label, obj, key, o) {
        o = o || {};
        var i = bind(obj, key, o);
        var v = obj[key];
        var html;

        if (o.type === 'select') {
            html = '<select data-b="' + i + '">' + o.options.map(function (opt) {
                return '<option value="' + esc(opt[0]) + '"' + (String(opt[0]) === String(v) ? ' selected' : '') + '>' + esc(opt[1]) + '</option>';
            }).join('') + '</select>';
        } else if (o.type === 'chk') {
            html = '<input type="checkbox" data-b="' + i + '"' + (v ? ' checked' : '') + '>';
        } else if (o.type === 'text') {
            html = '<input type="text" data-b="' + i + '" value="' + esc(v) + '"' + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + (o.list ? ' list="' + o.list + '"' : '') + (o.w ? ' style="width:' + o.w + '"' : '') + '>';
        } else {
            html = '<input type="text" inputmode="decimal" data-b="' + i + '" value="' + esc(Format.plain(v)) + '"'
                + (o.w ? ' style="width:' + o.w + '"' : '') + '>';
        }

        if (o.bare) return html;

        if (o.type === 'chk') return '<label class="field chk">' + html + ' ' + esc(label) + '</label>';
        return '<label class="field">' + esc(label) + html + '</label>';
    }

    function onChange(e) {
        var el = e.target;
        var idx = el.getAttribute('data-b');
        if (idx === null) { if (!fixtureChange(el) && !UiHydPumps.onChange(e, changed)) UiHydView.onChange(e, changed); return; }

        var b = reg[+idx];
        if (!b) return;

        var o = b.o;
        var v;

        if (o.type === 'chk') v = el.checked;
        else if (o.type === 'select' || o.type === 'text') v = el.value;
        else {
            v = Format.parse(el.value, b.obj[b.key]);
            if (o.type === 'int') v = Math.round(v);
            if (o.min !== undefined && v < o.min) v = o.min;
            if (o.max !== undefined && v > o.max) v = o.max;
            el.value = Format.plain(v);
        }

        if (o.type === 'select' && o.numeric) v = parseFloat(v);

        b.obj[b.key] = v;
        if (o.after) o.after(v, b.obj);
        changed(!!o.struct);
    }

    function onClick(e) {
        var el = e.target.closest('[data-act]');
        if (!el) { if (!UiHydPumps.onClick(e, changed) && !UiHydNote.onClick(e) && !UiHydPreview.onClick(e) && !UiHydItp.onClick(e) && !UiHydElss.onClick(e, changed)) UiHydView.onClick(e, changed); return; }

        var act = el.getAttribute('data-act');
        var arg = el.getAttribute('data-arg');
        if (actions[act]) { actions[act](arg, el); }
    }

    /* --- опросник ------------------------------------------------------------ */

    function materialOptions() {
        return HydData.MATERIALS.map(function (m) { return [m.key, m.name]; });
    }

    function survey() {
        var s = hyd().survey;
        var h = [];

        h.push('<div class="card no-print"><h2>Объект</h2><div class="form">');
        h.push(inp('Объект', s, 'objectName', { type: 'text', ph: 'Парковый 9, 10' }));
        h.push(inp('Высота здания, м (выше 75 — ветка записки для высотных)', s, 'height', { min: 0 }));
        h.push(inp('Паркинг', s, 'parking', { type: 'select', options: [['none', 'нет'], ['underground', 'подземный'], ['above', 'надземный']] }));
        h.push(inp('Отметка чистого пола 1 этажа, м (по умолчанию для стояков)', s, 'groundElev'));
        h.push(inp('Типовая высота этажа, м (по умолчанию для стояков)', s, 'floorHeight', { min: 2 }));
        h.push(inp('Отметка оси насосов и низа стояков по умолчанию, м', s, 'pumpElev'));
        h.push('</div><p class="hint">Ввод, насосные установки, ИТП, водомерные узлы и стояки задаются на схеме: поставьте объект '
            + 'и щёлкните по нему — справа откроются его параметры.</p></div>');

        h.push('<div class="card no-print"><h2>Холст</h2><div class="form">');
        h.push(inp('Масштаб: метров трубы на 1 px схемы', s, 'scale', { min: 0.005 }));
        h.push(inp('Высота этажа в блоке стояка, px', s, 'floorPx', { min: 10 }));
        h.push('</div><p class="hint">Длина трубы берётся с рисунка по этому масштабу. Любую длину можно задать числом в карточке трубы. '
            + 'Высота этажа в блоке стояка — только размер рисунка, в расчёт идёт высота этажа выше.</p></div>');

        h.push('<div class="card no-print"><h2>Трубы и скорости</h2><div class="form">');
        h.push(inp('Магистрали (подвал)', s.materials, 'mains', { type: 'select', options: materialOptions() }));
        h.push(inp('Стояки и этажные ветки', s.materials, 'risers', { type: 'select', options: materialOptions() }));
        h.push(inp('Квартирная разводка', s.materials, 'apartment', { type: 'select', options: materialOptions() }));
        h.push(inp('Предельная скорость в магистралях, м/с', s.vmax, 'mains', { min: 0.1 }));
        h.push(inp('в стояках, м/с', s.vmax, 'risers', { min: 0.1 }));
        h.push(inp('в квартирной разводке, м/с', s.vmax, 'apartment', { min: 0.1 }));
        h.push(inp('на вводе, м/с', s.vmax, 'input', { min: 0.1 }));
        h.push(inp('Вязкость ХВС, 10⁻⁶ м²/с', s.nu, 'cold', { min: 0.1 }));
        h.push(inp('Вязкость ГВС, 10⁻⁶ м²/с', s.nu, 'hot', { min: 0.1 }));
        h.push('</div><p class="hint">Сталь и нержавейка считаются по Шевелёву с запасом −1 мм на внутренний диаметр (как в образце: Ø48×3 даёт 41 мм), '
            + 'полимеры — как гладкие трубы по Колбруку. Допустимую скорость бюро задаёт само: в образцах 0,74–0,79 м/с; '
            + 'шум по приложению И СП 30 даёт 1,5 м/с и выше. Стояк считается одним диаметром на всю высоту.</p></div>');

        h.push('<div class="card no-print"><h2>Потери и напоры</h2><div class="form">');
        h.push(inp('Свободный напор у диктующего прибора Hпр, м (п. 8.21)', s, 'hPr', { min: 0 }));
        h.push(inp('Kl — местные потери от ΣHl (п. 8.28)', s, 'kl', { min: 0 }));
        h.push(inp('Потери в насосной станции Hнс, м', s, 'hNs', { min: 0 }));
        h.push(inp('Потери в ИТП Hитп, м', s, 'hItp', { min: 0 }));
        h.push(inp('Фильтр у счётчика, м', s, 'hFilter', { min: 0 }));
        h.push(inp('Регулятор давления с фильтром, м', s, 'hReg', { min: 0 }));
        h.push(inp('Регуляторы на квартирах', s, 'regulators', { type: 'select', options: [['auto', 'по статике'], ['all', 'на всех'], ['none', 'нет']] }));
        h.push(inp('Статика, при которой нужен регулятор, м (п. 8.22)', s, 'staticLimit', { min: 1 }));
        h.push(inp('Предел статики в зоне, м', s, 'zoneLimit', { min: 1 }));
        h.push(inp('Потери счётчиков', s.meter, 'method', { type: 'select', options: [['sp', 'по СП (S·q²)'], ['passport', 'по паспорту завода']] }));
        h.push(inp('Квартирный счётчик Ду 15, Qn', s.meter, 'aptQn', { type: 'select', numeric: true, options: [[1.5, 'Qn = 1,5 (по умолчанию)'], [1, 'Qn = 1'], [0.6, 'Qn = 0,6'], [0, 'подбирать по расходу']] }));
        h.push('</div><div class="row">');
        h.push(inp('Квартирные счётчики', s, 'apartmentMeter', { type: 'chk' }));
        h.push(inp('Счётчики с импульсным выходом (суффикс «д»)', s.meter, 'pulse', { type: 'chk' }));
        h.push('</div><p class="hint">Циркуляция Т4 в Hтр ГВС пока не входит — её даст отдельный этап расчёта.</p></div>');

        h.push('<div class="card no-print"><h2>Люди в квартире по числу комнат</h2>'
            + '<p class="hint">Используется, когда у выхода не задано число людей. 0 комнат — студия. '
            + 'Правило бюро (число людей по общей площади) подставляйте здесь же.</p><div class="row">');

        for (var r = 0; r <= 5; r++) {
            h.push(inp((r === 0 ? 'Студия' : r + '-комн.'), s.people, String(r), { type: 'int', min: 1, w: '5em' }));
        }

        h.push('</div></div>');
        return h.join('');
    }

    /* --- этажная разводка ----------------------------------------------------- */

    function typeOptions(withNone) {
        var list = hyd().floorTypes.map(function (t) { return [t.id, t.name]; });
        return withNone ? [['', '— нет выходов —']].concat(list) : list;
    }

    function usage(typeId) {
        var list = [];
        HydModel.risers(hyd()).forEach(function (r) {
            var uses = r.ranges.some(function (x) { return x.typeId === typeId; }) || r.exceptions.some(function (x) { return x.typeId === typeId; });
            if (uses) list.push(r.name || r.id);
        });
        return list;
    }

    function floors() {
        var d = hyd();
        var h = [];

        if (!state.typeId || !HydModel.typeById(d, state.typeId)) state.typeId = d.floorTypes.length ? d.floorTypes[0].id : '';
        var type = HydModel.typeById(d, state.typeId);

        h.push('<div class="card no-print"><div class="ctitle"><b>Этажная разводка — типовые этажи</b>'
            + '<span><button type="button" class="small" data-act="aptsXlsx" title="Квартиры по стоякам, зонам и этажам — отдельным файлом Excel (тот же лист есть в «Гидравлика в Excel»)">Квартиры по этажам (Excel)</button> '
            + '<button type="button" class="small" data-act="addType">+ тип этажа</button></span></div>'
            + '<p class="hint">Типовой этаж — набор коллекторных узлов и выходов-квартир на этаже. Один тип подставляется в любое число стояков '
            + 'и этажей: на схеме в блоке стояка указываете, какие этажи какого типа. Ниже — подпись каждого выхода по правилу '
            + '(<code>{n}</code> — сквозной номер, <code>{f}</code> — этаж), число комнат или людей, ход трубы от коллектора.</p>'
            + '<div class="subtabs">');

        d.floorTypes.forEach(function (t) {
            h.push('<button type="button" data-act="pickType" data-arg="' + esc(t.id) + '"' + (t.id === state.typeId ? ' class="on"' : '') + '>' + esc(t.name) + '</button>');
        });

        h.push('</div>');

        if (type) {
            var used = usage(type.id);
            h.push('<div class="row">' + inp('Название типа', type, 'name', { type: 'text' })
                + '<button type="button" class="small" data-act="dupType">Дублировать тип</button>'
                + '<button type="button" class="small danger" data-act="delType">Удалить тип</button>'
                + '<span class="note">' + (used.length ? 'Используется в стояках: ' + esc(used.join(', ')) : 'Пока не назначен ни одному стояку') + '</span></div>');

            type.collectors.forEach(function (c, ci) { h.push(collector(type, c, ci)); });

            h.push('<div class="row"><button type="button" class="small" data-act="addCollector" data-arg="floor">+ коллектор в полу</button>'
                + '<button type="button" class="small" data-act="addCollector" data-arg="ceiling">+ коллектор под потолком</button></div>');
        } else {
            h.push('<p class="hint">Типов этажей нет — добавьте.</p>');
        }

        h.push('</div>');
        return h.join('');
    }

    function focusCollector() {
        if (!state.focus) return;
        var el = body.querySelector('[data-col="' + state.focus + '"]');
        state.focus = '';
        if (el) {
            el.classList.add('focus');
            el.scrollIntoView({ block: 'start' });
        }
    }

    function collector(type, c, ci) {
        var d = hyd();
        var h = [];
        var fixtures = d.method === 'fixtures';

        h.push('<div class="section" data-col="' + esc(c.id) + '"><div class="row">');
        h.push(inp('Узел', c, 'name', { type: 'text' }));
        h.push(inp('Коллектор', c, 'type', {
            type: 'select', options: [['floor', 'в полу'], ['ceiling', 'под потолком']],
            after: function (v) { c.elev = v === 'ceiling' ? 2.4 : 0.3; }, struct: true
        }));
        h.push(inp('От стояка до коллектора, м', c, 'branchLen', { min: 0, w: '5em' }));
        h.push(inp('Отметка оси над полом, м', c, 'elev', { w: '5em' }));
        h.push('<button type="button" class="small" data-act="dupCollector" data-arg="' + ci + '">Дублировать</button>');
        h.push('<button type="button" class="small danger" data-act="delCollector" data-arg="' + ci + '">Удалить узел</button></div>');

        h.push('<div class="scroll"><table class="form"><thead><tr><th class="left">Подпись выхода</th><th>×</th><th>Комнат</th><th>Людей (0 — авто)</th>'
            + '<th>Ход от коллектора, м</th><th>Отм. прибора, м</th><th>Счётчик</th><th></th></tr></thead><tbody>');

        c.outlets.forEach(function (o, oi) {
            var ref = c.id + ':' + oi;
            h.push('<tr><td class="left">' + inp('', o, 'label', { type: 'text', bare: true }) + '</td>'
                + '<td>' + inp('', o, 'count', { type: 'int', min: 1, bare: true, w: '3.5em' }) + '</td>'
                + '<td>' + inp('', o, 'rooms', { type: 'select', numeric: true, options: [[0, 'студия'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5+']], bare: true }) + '</td>'
                + '<td>' + inp('', o, 'people', { type: 'int', min: 0, bare: true, w: '4em' }) + '</td>'
                + '<td>' + inp('', o, 'lenM', { min: 0, bare: true, w: '4.5em' }) + '</td>'
                + '<td>' + inp('', o, 'fixtureElev', { bare: true, w: '4.5em' }) + '</td>'
                + '<td class="c">' + inp('', o, 'meter', { type: 'chk', bare: true }) + '</td>'
                + '<td style="white-space:nowrap"><button type="button" class="mini" data-act="dupOutlet" data-arg="' + ref + '" title="Копия выхода">⧉</button> '
                + '<button type="button" class="mini danger" data-act="delOutlet" data-arg="' + ref + '">×</button></td></tr>');

            if (fixtures) {
                h.push('<tr><td class="left dim" colspan="8"><div class="row" style="margin:0;gap:10px">' + fixtureEditor(c, o) + '</div></td></tr>');
            }
        });

        h.push('</tbody></table></div>');
        h.push('<div class="row" style="margin-top:6px"><span class="note">Добавить выход:</span>'
            + [[1, '1-комн.'], [2, '2-комн.'], [3, '3-комн.'], [4, '4-комн.'], [0, 'студия']].map(function (r) {
                return '<button type="button" class="small" data-act="addOutlet" data-arg="' + c.id + ':' + r[0] + '">+ ' + r[1] + '</button>';
            }).join('')
            + '<span class="note">Размножить — число в колонке «×»: подписи пойдут по правилу.</span></div>');

        if (!fixtures) {
            h.push('<p class="hint">Способ «по людям»: приборы не заполняются, число приборов принимается равным числу людей (СП 30, 5.4). '
                + 'Для способа «по приборам» поставьте галочку вверху — под выходом появятся приборы.</p>');
        }

        h.push('</div>');
        return h.join('');
    }

    function fixtureEditor(c, o) {
        var counts = {};
        o.fixtures.forEach(function (f) { counts[f.id] = f.count; });

        var tpl = '<label class="field">Шаблон<select data-tpl="' + esc(c.id + ':' + o.id) + '"><option value="">—</option>'
            + HydData.APARTMENT_SETS.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('')
            + '</select></label>';

        return tpl + HydData.FIXTURES.map(function (f) {
            return '<label class="field">' + esc(f.name.replace(' со смесителем', '').replace(' со смывным бачком', '')) + (f.hot ? '' : ' ·хол.')
                + '<input type="text" inputmode="numeric" style="width:3.5em" data-fx="' + esc(f.id) + '" data-fo="' + esc(c.id + ':' + o.id) + '" value="' + (counts[f.id] || 0) + '"></label>';
        }).join('');
    }

    /* --- действия формы -------------------------------------------------------- */

    function findCollector(id) {
        var t = HydModel.typeById(hyd(), state.typeId);
        if (!t) return null;
        for (var i = 0; i < t.collectors.length; i++) if (t.collectors[i].id === id) return t.collectors[i];
        return null;
    }

    function clone(x) { return JSON.parse(JSON.stringify(x)); }

    function nextOutletId(c) { return HydModel.nextId('O', c.outlets); }

    function done() { changed(true); }

    var actions = {
        aptsXlsx: function () {
            var t = document.getElementById('hydHist');
            try {
                if (!result || !result.input) throw new Error('нужен расчёт: на схеме ввод и стояки');
                var sheet = HydReport.aptSheet(result, hyd());
                if (!sheet) throw new Error('на схеме нет стояков');
                var base = (hyd().survey.objectName || App.project.object && App.project.object.name || 'Объект').replace(/[\/:*?"<>|]/g, '-');
                Xlsx.save([sheet], base + ' — квартиры по этажам.xlsx');
                if (t) t.textContent = 'Квартиры по этажам выгружены в Excel';
            } catch (e) { if (t) t.textContent = 'Не выгружено: ' + e.message; }
        },
        addType: function () {
            var d = hyd();
            var id = HydModel.nextId('T', d.floorTypes);
            d.floorTypes.push({ id: id, name: 'Этаж ' + id.replace('T', ''), collectors: [] });
            state.typeId = id;
            done();
        },
        pickType: function (id) { state.typeId = id; renderBody(); },
        dupType: function () {
            var d = hyd();
            var t = HydModel.typeById(d, state.typeId);
            if (!t) return;
            var c = clone(t);
            c.id = HydModel.nextId('T', d.floorTypes);
            c.name = t.name + ' (копия)';
            d.floorTypes.push(c);
            state.typeId = c.id;
            done();
        },
        delType: function () {
            var d = hyd();
            if (d.floorTypes.length < 2) return;
            var id = state.typeId;
            d.floorTypes = d.floorTypes.filter(function (t) { return t.id !== id; });
            HydGraph.retype(d);
            state.typeId = d.floorTypes[0].id;
            done();
        },
        addCollector: function (kind) {
            var t = HydModel.typeById(hyd(), state.typeId);
            if (!t) return;
            var c = HydModel.newCollector(HydModel.nextId('C', t.collectors), kind);
            c.outlets = [HydModel.newOutlet('O1', 2)];
            t.collectors.push(c);
            done();
        },
        dupCollector: function (i) {
            var t = HydModel.typeById(hyd(), state.typeId);
            var c = clone(t.collectors[+i]);
            c.id = HydModel.nextId('C', t.collectors);
            c.name = 'Узел ' + c.id.replace('C', '');
            t.collectors.splice(+i + 1, 0, c);
            done();
        },
        delCollector: function (i) {
            var t = HydModel.typeById(hyd(), state.typeId);
            t.collectors.splice(+i, 1);
            done();
        },
        addOutlet: function (arg) {
            var p = arg.split(':');
            var c = findCollector(p[0]);
            if (!c) return;
            c.outlets.push(HydModel.newOutlet(nextOutletId(c), +p[1]));
            done();
        },
        dupOutlet: function (arg) {
            var p = arg.split(':');
            var c = findCollector(p[0]);
            var o = clone(c.outlets[+p[1]]);
            o.id = nextOutletId(c);
            c.outlets.splice(+p[1] + 1, 0, o);
            done();
        },
        delOutlet: function (arg) {
            var p = arg.split(':');
            var c = findCollector(p[0]);
            c.outlets.splice(+p[1], 1);
            done();
        }
    };

    /* Приборы выхода: число по каждому прибору и шаблон квартиры. Ключ — «коллектор:выход». */
    function outletByKey(key) {
        var p = String(key).split(':');
        var c = findCollector(p[0]);
        if (!c) return null;
        for (var i = 0; i < c.outlets.length; i++) if (c.outlets[i].id === p[1]) return c.outlets[i];
        return null;
    }

    function fixtureChange(el) {
        var fx = el.getAttribute('data-fx');

        if (fx) {
            var o = outletByKey(el.getAttribute('data-fo'));
            if (!o) return true;
            var n = Math.max(0, Math.round(Format.parse(el.value, 0)));
            o.fixtures = o.fixtures.filter(function (f) { return f.id !== fx; });
            if (n > 0) o.fixtures.push({ id: fx, count: n });
            changed(false);
            return true;
        }

        if (el.hasAttribute('data-tpl')) {
            var oo = outletByKey(el.getAttribute('data-tpl'));
            var set = HydData.APARTMENT_SETS.filter(function (s) { return s.id === el.value; })[0];
            if (oo && set) {
                oo.fixtures = set.fixtures.map(function (f) { return { id: f[0], count: f[1] }; });
                changed(true);
            }
            return true;
        }

        return false;
    }

    /* Из схемы — в этажную разводку: открыть тип и подсветить узел. */
    function openFloors(typeId, collectorId) {
        state.sub = 'floors';
        if (typeId) state.typeId = typeId;
        state.focus = collectorId || '';
        renderBody();
    }

    return {
        init: init,
        render: render,
        run: run,
        onShow: onShow,
        state: state,
        get result() { return result; },
        changed: changed,
        inp: inp,
        bind: bind,
        compute: compute,
        openFloors: openFloors,
        undo: undo,
        redo: redo,
        history: history,
        typeOptions: typeOptions,
        renderBody: renderBody
    };
})();
