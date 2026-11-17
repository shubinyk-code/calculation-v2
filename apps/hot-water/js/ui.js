'use strict';

/*
    Связка: состояние программы, панели, переключение видов и систем.

    Правка чего угодно ведёт к полному пересчёту — с задержкой в 150 мс, чтобы
    ввод в поле не запускал расчёт на каждой цифре. Пересчитывать частями нельзя:
    диаметр меняет потери, потери меняют невязку, невязка меняет подобранный клапан.
*/

var App = (function () {

    var app = {
        projectName: 'Без названия',
        network: new HwNetwork(),
        settings: new CalcSettings(),

        /* Заготовка, из которой рождается каждая новая труба. */
        template: {
            zoneKey: 'Т#1',
            supplyName: 'Т3.1',
            returnName: 'Т4.1',
            material: 'Сталь ВГП оцинкованная ГОСТ 3262-75',
            nominalMm: 32,
            insulationName: 'Вспененный каучук (K-Flex, Armaflex)',
            insulationMm: 13,
            defaultLength: 3.0
        },

        selection: null,
        zoneFilter: null,          // null — все системы
        colourMode: 'kind',
        activeTable: 'zones',
        activeView: '3d',

        /*
            Настроечные положения клапанов, выставленные вручную в проверочном
            расчёте: ключ — номер кольца, значение — что набрано. В сети и в файле
            проекта им места нет: это предположение «что если», а не свойство
            клапана, и в ведомость оно попасть не должно.
        */
        proofPositions: {}
    };

    var views = {};
    var recalcTimer = null;
    var dirty = false;

    /* Сообщение, которое должно пережить ближайший пересчёт. */
    var pendingStatus = null;

    // --- фильтр по системам ---------------------------------------------------

    app.acceptsZoneKey = function (key) {
        return !app.zoneFilter || app.zoneFilter === key;
    };

    app.accepts = function (segment) {
        return app.acceptsZoneKey(segment.zoneKey);
    };

    app.acceptsZone = function (zone) {
        return app.acceptsZoneKey(zone.key);
    };

    // --- выделение ------------------------------------------------------------

    app.select = function (hit) {
        app.selection = hit;
        renderInspector();
        renderTable();
        drawAll();
    };

    app.isSelected = function (kind, index) {
        return !!app.selection && app.selection.kind === kind && app.selection.index === index;
    };

    /** Кольцо выбранного участка подсвечивается целиком. */
    app.isHighlighted = function (segment) {
        if (!app.selection || app.selection.kind !== 'segment') return false;

        var chosen = app.network.segments[app.selection.index];
        if (!chosen || chosen.index === segment.index) return false;
        if (chosen.ringIndices.length === 0) return false;

        for (var i = 0; i < chosen.ringIndices.length; i++) {
            if (segment.ringIndices.indexOf(chosen.ringIndices[i]) >= 0)
                return true;
        }
        return false;
    };

    app.deleteSelection = function () {
        if (!app.selection) return;

        if (app.selection.kind === 'segment')
            NetworkEdit.removeSegment(app.network, app.selection.index);
        else
            NetworkEdit.removeNode(app.network, app.selection.index);

        app.selection = null;
        app.afterEdit('удаление');
    };

    // --- пересчёт -------------------------------------------------------------

    /** Правка сети или исходных данных. Пересчёт откладывается на 150 мс. */
    app.afterEdit = function (label) {
        dirty = true;
        setStatus('пересчёт…', '');

        // Шаг отмены запоминается сразу, а не в отложенном пересчёте: между
        // правкой и пересчётом человек успевает сделать вторую, и обе должны
        // отменяться по отдельности.
        // Обработчик события передаёт сюда сам Event — на метку это не годится.
        History.record(app, typeof label === 'string' ? label : null);
        refreshHistoryButtons();

        if (recalcTimer) clearTimeout(recalcTimer);
        recalcTimer = setTimeout(function () {
            recalcTimer = null;
            app.recalculate();
        }, 150);
    };

    /*
        Отмена возвращает состояние целиком: сеть, ИТП, зоны и исходные данные.
        Выделение при этом снимается — участок, на который оно указывало, мог
        только что исчезнуть, а показывать инспектору чужие числа нельзя.
    */
    function undo() {
        var label = History.undo(app);
        if (!label) { setStatus('отменять нечего', 'warn'); return; }

        app.selection = null;
        app.recalculate();
        refreshHistoryButtons();
        setStatus('отменено: ' + label, 'done');
    }

    function redo() {
        var label = History.redo(app);
        if (!label) { setStatus('возвращать нечего', 'warn'); return; }

        app.selection = null;
        app.recalculate();
        refreshHistoryButtons();
        setStatus('возвращено: ' + label, 'done');
    }

    function refreshHistoryButtons() {
        var undoButton = byId('undoBtn');
        var redoButton = byId('redoBtn');
        if (!undoButton) return;

        undoButton.disabled = !History.canUndo();
        redoButton.disabled = !History.canRedo();

        undoButton.title = History.canUndo()
            ? 'Отменить ' + History.undoLabel() + '  (Ctrl+Z), шагов в запасе: ' + History.depth()
            : 'Отменять нечего';

        redoButton.title = History.canRedo()
            ? 'Вернуть ' + History.redoLabel() + '  (Ctrl+Y)'
            : 'Возвращать нечего';
    }

    app.recalculate = function () {
        var started = Date.now();

        app.settings.useNormMethod = byId('method').value === 'norm';
        Calc.run(app.network, app.settings);

        // Плоская схема раскладывается по разобранным кольцам. Узлы, которые
        // человек уже двигал руками, остаются на месте: он их туда поставил.
        if (!app.flatTouched) {
            if (app.network.rings.length > 0) AutoLayout.build(app.network);
            else AutoLayout.buildRough(app.network);
        }

        dirty = false;
        Storage.autosave(app);

        fillZoneFilter();
        renderInspector();
        renderTable();
        drawAll();

        var rings = app.network.rings.length;

        /*
            Сообщение о пачечной правке важнее итога пересчёта и потому его
            перебивает. Иначе «диаметров заменено: 9» не увидеть вовсе:
            правка ставит статус сразу, а пересчёт через 150 мс затирает его
            своим «посчитано», и человек не знает, сработала кнопка или нет.
        */
        if (pendingStatus) {
            setStatus(pendingStatus.text + ' · колец ' + rings, pendingStatus.kind);
            pendingStatus = null;
            return;
        }

        setStatus(rings > 0
            ? 'посчитано: колец ' + rings + ', ' + (Date.now() - started) + ' мс'
            : 'колец не найдено — проверьте перемычки и ИТП',
            rings > 0 ? 'done' : 'warn');
    };

    /** Что сказать после ближайшего пересчёта вместо обычного «посчитано». */
    function sayAfterRecalc(text, kind) {
        pendingStatus = { text: text, kind: kind || 'done' };
    }

    // --- отрисовка ------------------------------------------------------------

    function drawAll() {
        views['3d'].draw();
        views.flat.draw();
    }

    app.draw = drawAll;

    // --- панели ---------------------------------------------------------------

    function byId(id) { return document.getElementById(id); }

    function setStatus(text, kind) {
        var node = byId('status');
        node.textContent = text;
        node.className = 'status' + (kind ? ' ' + kind : '');
    }

    function option(value, text) {
        var node = document.createElement('option');
        node.value = value;
        node.textContent = text;
        return node;
    }

    function fillZoneFilter() {
        var select = byId('zoneFilter');
        var previous = app.zoneFilter;

        select.innerHTML = '';
        select.appendChild(option('', 'все системы'));

        for (var i = 0; i < app.network.zones.length; i++) {
            var zone = app.network.zones[i];
            select.appendChild(option(zone.key, zone.caption));
        }

        select.value = previous || '';
        if (select.value !== (previous || '')) app.zoneFilter = null;

        fillTemplateZones();
    }

    /*
        Список систем для заготовки. В одном проекте их бывает несколько —
        зоны 1, 2, 3 и встройка, — и у каждой свой выход ИТП.
    */
    function fillTemplateZones() {
        var select = byId('tplZone');
        var previous = app.template.zoneKey;
        select.innerHTML = '';

        var seen = {};
        var i;

        for (i = 0; i < app.network.zones.length; i++) {
            var zone = app.network.zones[i];
            seen[zone.key] = true;
            select.appendChild(option(zone.key, zone.caption));
        }

        // Заранее заготовленные системы, которых в сети ещё нет: без них
        // первую трубу не начертить.
        for (i = 1; i <= 4; i++) {
            var key = 'Т#' + i;
            if (seen[key]) continue;
            select.appendChild(option(key, 'Т3.' + i + ' / Т4.' + i));
        }

        select.appendChild(option('__new__', 'Новая система…'));
        select.value = previous;
        if (!select.value) select.value = 'Т#1';
        applyTemplateZone(select.value);
    }

    function applyTemplateZone(key) {
        if (key === '__new__') return;

        app.template.zoneKey = key;

        var zone = app.network.zone(key);
        if (zone && zone.supplyNames.length > 0) {
            app.template.supplyName = zone.supplyNames[0];
            app.template.returnName = zone.returnNames[0] || 'Т4';
            return;
        }

        var number = key.replace('Т#', '');
        app.template.supplyName = 'Т3' + (number ? '.' + number : '');
        app.template.returnName = 'Т4' + (number ? '.' + number : '');
    }

    function fillTemplateControls() {
        var material = byId('tplMaterial');
        var i;

        material.innerHTML = '';
        for (i = 0; i < PipeCatalog.Groups.length; i++) {
            var group = document.createElement('optgroup');
            group.label = PipeCatalog.Groups[i].name;

            for (var m = 0; m < PipeCatalog.Groups[i].materials.length; m++) {
                var name = PipeCatalog.Groups[i].materials[m].name;
                group.appendChild(option(name, name));
            }
            material.appendChild(group);
        }
        material.value = app.template.material;

        fillTemplateSizes();

        var insulation = byId('tplInsulation');
        insulation.innerHTML = '';
        for (i = 0; i < InsulationCatalog.Kinds.length; i++)
            insulation.appendChild(option(InsulationCatalog.Kinds[i].name, InsulationCatalog.Kinds[i].name));
        insulation.value = app.template.insulationName;

        var thickness = byId('tplThickness');
        thickness.innerHTML = '';
        for (i = 0; i < InsulationCatalog.Thicknesses.length; i++)
            thickness.appendChild(option(InsulationCatalog.Thicknesses[i], InsulationCatalog.Thicknesses[i]));
        thickness.value = app.template.insulationMm;

        byId('tplLength').value = app.template.defaultLength;
    }

    function fillTemplateSizes() {
        var select = byId('tplSize');
        var sizes = PipeCatalog.sizesOf(app.template.material);
        select.innerHTML = '';

        for (var i = 0; i < sizes.length; i++)
            select.appendChild(option(sizes[i].nominalMm, sizes[i].caption));

        select.value = String(app.template.nominalMm);
        if (!select.value && sizes.length > 0) {
            select.value = String(sizes[0].nominalMm);
            app.template.nominalMm = sizes[0].nominalMm;
        }
    }

    // --- инспектор ------------------------------------------------------------

    function row(parent, name, value) {
        var div = document.createElement('div');
        div.className = 'row';

        var left = document.createElement('span');
        left.textContent = name;

        var right = document.createElement('span');
        right.textContent = value;

        div.appendChild(left);
        div.appendChild(right);
        parent.appendChild(div);
    }

    function heading(parent, text) {
        var h = document.createElement('h4');
        h.textContent = text;
        parent.appendChild(h);
    }

    function renderInspector() {
        var box = byId('inspector');
        box.innerHTML = '';

        if (!app.selection) {
            var hint = document.createElement('p');
            hint.className = 'hint';
            hint.textContent = 'Ничего не выбрано. Щёлкните по участку или узлу.';
            box.appendChild(hint);
            return;
        }

        if (app.selection.kind === 'node') {
            var node = app.network.nodes[app.selection.index];
            if (!node) { box.textContent = ''; return; }

            heading(box, app.network.isSource(app.selection.index) ? 'Узел ИТП' : 'Узел');
            row(box, 'Номер', node.number > 0 ? String(node.number) : '—');
            row(box, 'X, Y, Z, м', Fmt.length(node.point3d.x) + '  '
                + Fmt.length(node.point3d.y) + '  ' + Fmt.length(node.point3d.z));
            row(box, 'Присоединений', String(node.segments.length));
            row(box, 'Температура, °C', node.temperature > 0 ? Fmt.temperature(node.temperature) : '—');
            return;
        }

        var segment = app.network.segments[app.selection.index];
        if (!segment) { box.textContent = ''; return; }

        heading(box, segment.isRingClosure ? 'Перемычка Т3–Т4'
            : segment.isVirtualLink ? 'Сшивка разрыва'
            : 'Участок ' + roleCaption(segment.role));

        row(box, 'Номер', segment.number > 0 ? '№' + segment.number : '—');
        row(box, 'Узлы', app.network.nodes[segment.nodeA].number + ' → '
            + app.network.nodes[segment.nodeB].number);
        row(box, 'Система', segment.systemName || '—');
        row(box, 'Тип', segment.isCirculating ? 'кольцевой' : 'тупиковый');

        if (segment.ringIndices.length > 0) {
            var numbers = [];
            for (var i = 0; i < segment.ringIndices.length; i++)
                numbers.push(app.network.rings[segment.ringIndices[i]].number);
            row(box, 'Кольца', numbers.join(', '));
        }

        if (!segment.isVirtualLink) {
            heading(box, 'Труба');
            row(box, 'Материал', segment.material || '—');
            row(box, 'Ду / Dн / Dвн, мм', Fmt.fixed(segment.nominalDiameterMm, 0) + ' / '
                + Fmt.fixed(segment.outerDiameter * 1000, 1) + ' / '
                + Fmt.fixed(segment.innerDiameter * 1000, 1));
            row(box, 'Длина, м', Fmt.length(segment.length));
            row(box, 'Изоляция', (segment.insulationName || 'нет')
                + (segment.insulationThickness > 0
                    ? ', ' + Fmt.fixed(segment.insulationThickness * 1000, 0) + ' мм' : ''));
            // Стальные считаются по Шевелёву, и шероховатость там ни при чём:
            // состояние трубы заложено в сами коэффициенты.
            if (HeatLoss.isCarbonSteel(segment.material))
                row(box, 'Закон трения', 'Шевелёв, неновые трубы');
            else
                row(box, 'Шероховатость, мм',
                    Fmt.num(HeatLoss.roughness(segment.material, app.settings.roughnessMm)));
        }

        if (segment.isCirculating) {
            heading(box, 'Расчёт');
            row(box, 'q, Вт/м', Fmt.heatFlux(segment.heatFluxPerMetre));
            row(box, 'Q, Вт', Fmt.watts(segment.heatLoss));
            row(box, 'Расход, л/с', Fmt.flowLs(segment.flow));
            row(box, 'Скорость, м/с', Fmt.velocity(segment.velocity));
            row(box, 'Δp трубы, кПа', Fmt.pressure(segment.pipeDrop));
            if (segment.valveDrop > 0)
                row(box, 'Δp клапана, кПа', Fmt.pressure(segment.valveDrop));
            row(box, 't вход → выход, °C', Fmt.temperature(segment.temperatureIn)
                + ' → ' + Fmt.temperature(segment.temperatureOut));
            if (segment.suggestedDiameterMm > 0)
                row(box, 'Рекомендуемый Ду, мм', Fmt.fixed(segment.suggestedDiameterMm, 0));
        }

        if (segment.valve) {
            heading(box, 'Балансировочный клапан');
            row(box, 'Поставлен', segment.valve.automatic ? 'расчётом' : 'вручную');

            if (segment.valve.model) {
                row(box, 'Кольцо', '№' + segment.valve.ringNumber);
                row(box, 'Артикул', segment.valve.model.caption);
                row(box, 'Настройка',
                    ValveCatalog.formatPosition(segment.valve.model, segment.valve.position)
                    + '  (расчётная '
                    + Fmt.fixed(segment.valve.exactPosition, segment.valve.model.step < 1 ? 2 : 1)
                    + ')');
                row(box, 'Требуемый Kv', Fmt.kv(segment.valve.requiredKv));
                row(box, 'Kv на настройке', Fmt.kv(segment.valve.actualKv));
                row(box, 'Фактический Δp, кПа', Fmt.pressure(segment.valve.actualDrop));
            } else {
                row(box, 'Настройка', 'открыт полностью');
            }

            if (segment.valve.note) note(box, segment.valve.note);
        }

        if (segment.note) note(box, segment.note);
    }

    function note(box, text) {
        var p = document.createElement('p');
        p.className = 'note';
        p.textContent = text;
        box.appendChild(p);
    }

    // --- таблицы --------------------------------------------------------------

    function renderTabs() {
        var tabs = byId('tableTabs');
        tabs.innerHTML = '';

        for (var i = 0; i < Tables.Names.length; i++) {
            (function (name) {
                var button = document.createElement('button');
                button.textContent = Tables.titleOf(name);
                if (name === app.activeTable) button.className = 'active';

                button.addEventListener('click', function () {
                    app.activeTable = name;
                    renderTabs();
                    renderTable();
                });

                tabs.appendChild(button);
            })(Tables.Names[i]);
        }

        byId('roleFilterWrap').className =
            app.activeTable === 'segments' ? 'field inline' : 'field inline hidden';

        byId('proofWrap').className =
            app.activeTable === 'proof' ? 'field inline' : 'field inline hidden';

        if (app.activeTable !== 'proof') {
            byId('proofHint').textContent = '';
            byId('proofHint').className = 'status hidden';
        }
    }

    function renderTable() {
        if (app.activeTable === 'proof') runProof();

        var body = byId('tableBody');
        body.innerHTML = '';
        body.appendChild(Tables.render(app.activeTable, app));
    }

    /*
        Проверочный расчёт считается только когда его вкладка открыта.

        Он тяжелее основного — два потокораспределения на зону, — а нужен
        не всегда. Схему и результаты основного расчёта не трогает: решатель
        возвращает всё, что брал.
    */
    function runProof() {
        var totals = {};
        var typed = String(byId('proofFlow').value).trim().replace(',', '.');
        var asked = parseFloat(typed);
        var given = isFinite(asked) && asked > 0;

        // Набрано что-то, но не число. Молча считать по расчётному расходу
        // нельзя: человек видел бы свои цифры в поле и чужие в таблице.
        var junk = typed.length > 0 && !given;

        /*
            Расход задаётся на ИТП, а ИТП у каждой системы свой: одно число
            на несколько систем разнести не по чему. Поэтому ищутся системы,
            к которым число может относиться, — попавшие под фильтр и имеющие
            кольца. Одна такая — число идёт ей, даже если в списке стоит
            «все системы»: в проекте с одной системой выбирать её отдельно
            было бы лишним движением. Несколько — программа говорит, что
            надо выбрать, а не раскладывает расход наугад.
        */
        var aimed = [];
        for (var i = 0; i < app.network.zones.length; i++) {
            var zone = app.network.zones[i];
            if (zone.rings.length > 0 && app.acceptsZoneKey(zone.key))
                aimed.push(zone);
        }

        if (given && aimed.length === 1)
            totals[aimed[0].key] = asked / 1000.0 * Water.Density * 3600.0;

        app.proof = ProofSolver.run(app.network, app.settings, totals, app.proofPositions);

        var hand = 0;
        for (i = 0; i < app.proof.zones.length; i++)
            hand += app.proof.zones[i].handPositions;

        var hint = byId('proofHint');
        if (junk) {
            hint.textContent = '«' + String(byId('proofFlow').value).trim()
                + '» — не расход; считаю по расчётному';
            hint.className = 'status warn';
        } else if (given && aimed.length > 1) {
            hint.textContent = 'систем несколько — выберите нужную вверху, '
                + 'расход задаётся на её ИТП';
            hint.className = 'status warn';
        } else if (given && aimed.length === 0) {
            hint.textContent = 'задавать расход некуда: колец нет';
            hint.className = 'status warn';
        } else if (app.proof.notes.length > 0) {
            hint.textContent = app.proof.notes[0];
            hint.className = 'status warn';
        } else if (given) {
            hint.textContent = 'расход задан системе «' + aimed[0].caption + '»'
                + (hand > 0 ? ', положений вручную: ' + hand : '');
            hint.className = 'status';
        } else if (hand > 0) {
            hint.textContent = 'положений клапанов задано вручную: ' + hand
                + ' — очистите поля, чтобы вернуться к расчётным';
            hint.className = 'status';
        } else {
            hint.textContent = '';
            hint.className = 'status hidden';
        }
    }

    /*
        Пересчёт только проверочной вкладки, без основного расчёта.

        Положение клапана «что если» сеть не меняет — менять расходы, подбор
        и ведомость из-за предположения нельзя. Поэтому здесь не afterEdit:
        ни шага отмены, ни пересчёта, ни записи в черновик. Только эта таблица.
    */
    app.refreshProof = function () {
        if (app.activeTable !== 'proof') return;
        renderTable();
    };

    // --- подписи и раскраска --------------------------------------------------

    function renderLabels() {
        var box = byId('labels');
        box.innerHTML = '';

        for (var i = 0; i < LabelOptions.keys.length; i++) {
            (function (key) {
                var label = document.createElement('label');
                label.className = 'check';

                var input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = LabelOptions[key];
                input.addEventListener('change', function () {
                    LabelOptions[key] = input.checked;
                    drawAll();
                });

                label.appendChild(input);
                label.appendChild(document.createTextNode(' ' + LabelOptions.captions[key]));
                box.appendChild(label);
            })(LabelOptions.keys[i]);
        }
    }

    function renderLegend() {
        var box = byId('legend');
        box.innerHTML = '';

        var items = app.colourMode === 'kind'
            ? [['Т3 подающий', Theme.supply], ['Т4 циркуляционный', Theme.circulation],
               ['Т4 без циркуляции', Theme.noCirculation], ['перемычка', Theme.ringClosure],
               ['сшивка', Theme.stitch], ['тупик', Theme.deadEnd]]
            : legendScale();

        for (var i = 0; i < items.length; i++) {
            var span = document.createElement('span');
            var swatch = document.createElement('i');
            swatch.style.background = items[i][1];
            span.appendChild(swatch);
            span.appendChild(document.createTextNode(items[i][0]));
            box.appendChild(span);
        }
    }

    function legendScale() {
        if (app.colourMode === 'temperature')
            return [['55 °C', Theme.temperatureScale[0]], ['60 °C', Theme.temperatureScale[3]],
                    ['65 °C', Theme.temperatureScale[5]]];

        if (app.colourMode === 'velocity')
            return [['0', Theme.rateScale[0]], ['0,75 м/с', Theme.rateScale[2]],
                    ['1,5 м/с', Theme.rateScale[5]]];

        if (app.colourMode === 'diameter')
            return [['Ду15', Theme.rateScale[0]], ['Ду50', Theme.rateScale[2]],
                    ['Ду100', Theme.rateScale[5]]];

        return [['меньше', Theme.rateScale[0]], ['больше', Theme.rateScale[5]]];
    }

    // --- исходные данные ------------------------------------------------------

    function openSettings() {
        var inputs = document.querySelectorAll('[data-setting]');

        for (var i = 0; i < inputs.length; i++) {
            var input = inputs[i];
            var key = input.dataset.setting;

            if (input.type === 'checkbox') input.checked = !!app.settings[key];
            else input.value = app.settings[key];
        }

        renderZoneConditions();
        byId('modal').className = 'modal';
    }

    function closeSettings() {
        var inputs = document.querySelectorAll('[data-setting]');

        for (var i = 0; i < inputs.length; i++) {
            var input = inputs[i];
            var key = input.dataset.setting;

            if (input.type === 'checkbox') {
                app.settings[key] = input.checked;
            } else {
                var value = parseFloat(String(input.value).replace(',', '.'));
                if (isFinite(value)) app.settings[key] = value;
            }
        }

        byId('modal').className = 'modal hidden';
        app.afterEdit('исходные данные');
    }

    /*
        Условия прокладки по системам. Подвал, шахта и чердак греются в разную
        среду, а теплопотери линейно зависят от разности температур: одно общее
        значение на всю сеть заметно врёт, когда зоны идут по разным помещениям.
    */
    function renderZoneConditions() {
        var box = byId('zoneConditions');
        box.innerHTML = '';

        if (app.network.zones.length === 0) {
            box.innerHTML = '<p class="hint">Систем пока нет.</p>';
            return;
        }

        var table = document.createElement('table');
        table.innerHTML = '<tr><th>Система</th><th>α, Вт/(м²·К)</th><th>t окр, °C</th><th>считать</th></tr>';

        for (var i = 0; i < app.network.zones.length; i++) {
            (function (zone) {
                var tr = document.createElement('tr');

                var name = document.createElement('td');
                name.textContent = zone.caption;
                tr.appendChild(name);

                var conditions = app.settings.zoneFor(zone.key);

                tr.appendChild(numberCell(conditions && conditions.hasAlpha ? conditions.alpha : '',
                    function (value) {
                        var target = app.settings.zoneEnsure(zone.key);
                        target.hasAlpha = value !== null;
                        if (value !== null) target.alpha = value;
                    }));

                tr.appendChild(numberCell(conditions && conditions.hasAmbient ? conditions.ambient : '',
                    function (value) {
                        var target = app.settings.zoneEnsure(zone.key);
                        target.hasAmbient = value !== null;
                        if (value !== null) target.ambient = value;
                    }));

                var enabledCell = document.createElement('td');
                var enabled = document.createElement('input');
                enabled.type = 'checkbox';
                enabled.checked = zone.isEnabled;
                enabled.addEventListener('change', function () { zone.isEnabled = enabled.checked; });
                enabledCell.appendChild(enabled);
                tr.appendChild(enabledCell);

                table.appendChild(tr);
            })(app.network.zones[i]);
        }

        box.appendChild(table);
    }

    function numberCell(value, apply) {
        var td = document.createElement('td');
        var input = document.createElement('input');
        input.type = 'number';
        input.step = '0.5';
        input.value = value === '' ? '' : value;
        input.placeholder = 'как общее';

        input.addEventListener('change', function () {
            var text = String(input.value).replace(',', '.').trim();
            if (text.length === 0) { apply(null); return; }

            var parsed = parseFloat(text);
            apply(isFinite(parsed) ? parsed : null);
        });

        td.appendChild(input);
        return td;
    }

    // --- свойства систем ------------------------------------------------------

    /*
        Окно, которое задаёт материал, изоляцию и фирму арматуры сразу всем
        участкам. Без него на импортированной сети пришлось бы править несколько
        сотен строк по одной, а свойства эти почти всегда общие на всю систему.

        Диаметр намеренно не трогается: он у каждого участка свой и означает
        совсем другое. Меняется только то, что действительно задаётся «базово».
    */
    function openProps() {
        var scope = byId('propsScope');
        var i;

        scope.innerHTML = '';
        scope.appendChild(option('', 'ко всем системам'));
        for (i = 0; i < app.network.zones.length; i++)
            scope.appendChild(option(app.network.zones[i].key, app.network.zones[i].caption));
        scope.value = app.zoneFilter || '';

        var material = byId('propsMaterial');
        material.innerHTML = '';
        for (i = 0; i < PipeCatalog.Groups.length; i++) {
            var group = document.createElement('optgroup');
            group.label = PipeCatalog.Groups[i].name;

            for (var m = 0; m < PipeCatalog.Groups[i].materials.length; m++) {
                var name = PipeCatalog.Groups[i].materials[m].name;
                group.appendChild(option(name, name));
            }
            material.appendChild(group);
        }
        material.value = app.template.material;

        var insulation = byId('propsInsulation');
        insulation.innerHTML = '';
        for (i = 0; i < InsulationCatalog.Kinds.length; i++)
            insulation.appendChild(option(InsulationCatalog.Kinds[i].name, InsulationCatalog.Kinds[i].name));
        insulation.value = app.template.insulationName;

        var thickness = byId('propsThickness');
        thickness.innerHTML = '';
        for (i = 0; i < InsulationCatalog.Thicknesses.length; i++)
            thickness.appendChild(option(InsulationCatalog.Thicknesses[i], InsulationCatalog.Thicknesses[i]));
        thickness.value = app.template.insulationMm;

        var brand = byId('propsBrand');
        brand.innerHTML = '';
        for (i = 0; i < ValveCatalog.Brands.length; i++)
            brand.appendChild(option(ValveCatalog.Brands[i], ValveCatalog.Brands[i]));
        brand.value = app.settings.valveBrand;

        byId('propsModal').className = 'modal';
    }

    function applyProps() {
        var scope = byId('propsScope').value || null;
        var useMaterial = byId('propsUseMaterial').checked;
        var useInsulation = byId('propsUseInsulation').checked;

        var material = byId('propsMaterial').value;
        var insulation = byId('propsInsulation').value;
        var thickness = parseFloat(byId('propsThickness').value);

        app.settings.valveBrand = byId('propsBrand').value;

        // Заготовка новой трубы едет следом: иначе следующая начерченная труба
        // вышла бы не такой, как вся сеть вокруг неё.
        if (useMaterial) app.template.material = material;
        if (useInsulation) {
            app.template.insulationName = insulation;
            app.template.insulationMm = thickness;
        }

        var touched = 0;
        var adjusted = 0;

        for (var i = 0; i < app.network.segments.length; i++) {
            var segment = app.network.segments[i];

            if (segment.isVirtualLink) continue;                  // перемычки не трубы
            if (scope && segment.zoneKey !== scope) continue;

            touched++;

            if (useMaterial) {
                // Ду сохраняется, если он есть у нового материала. Нет — берётся
                // ближайший по внутреннему диаметру: скорость и потери считаются
                // по нему, и подменять его наугад нельзя молча.
                if (!Calc.applySize(segment, material, segment.nominalDiameterMm)) {
                    var near = PipeCatalog.nearest(material, segment.innerDiameter);
                    if (near) {
                        Calc.applySize(segment, material, near.nominalMm);
                        adjusted++;
                    }
                }
            }

            if (useInsulation)
                Calc.applyInsulation(segment, insulation, thickness);
        }

        byId('propsModal').className = 'modal hidden';

        if (touched === 0) {
            setStatus('участков под эти условия не нашлось', 'warn');
            return;
        }

        fillTemplateControls();

        sayAfterRecalc('задано участкам: ' + touched
            + (adjusted > 0 ? ', из них Ду подобран заново у ' + adjusted : ''));

        app.afterEdit('свойства систем');
    }

    /*
        --- рекомендуемые диаметры ------------------------------------------

        Колонка «Реком. Ду» в таблице участков советует и всё: менять надо
        было по строкам руками. Здесь то же самое списком и разом.

        Со списком, а не одной кнопкой «применить всё», по двум причинам.
        Первая: рекомендация бывает нежелательной — магистраль в подвале
        специально кладут с запасом под будущую пристройку, и сужать её
        не надо. Вторая: смена диаметра на одном участке меняет скорости
        у соседей по кольцу, и после применения часть рекомендаций станет
        другой. Видеть, что именно меняется, важнее, чем сэкономить щелчок.
    */
    function recommendations() {
        var out = [];

        for (var i = 0; i < app.network.segments.length; i++) {
            var segment = app.network.segments[i];

            if (segment.isVirtualLink) continue;
            if (segment.suggestedDiameterMm <= 0.0) continue;
            if (!app.accepts(segment)) continue;

            var size = PipeCatalog.find(segment.material, segment.suggestedDiameterMm);

            out.push({
                index: i,
                segment: segment,
                nominal: segment.suggestedDiameterMm,
                size: size,
                after: size ? Hydraulics.velocity(segment.flow, size.inner) : 0.0,
                why: segment.velocity > app.settings.maxVelocity
                    ? 'скорость выше допустимой ' + Fmt.velocity(app.settings.maxVelocity) + ' м/с'
                    : 'скорость ниже ' + Fmt.velocity(app.settings.minVelocity)
                        + ' м/с — диаметр завышен'
            });
        }

        return out;
    }

    function openSizes() {
        var list = recommendations();
        var box = byId('sizesBody');
        box.innerHTML = '';

        if (list.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'hint';
            empty.textContent = app.network.segments.length === 0
                ? 'Сеть пустая — рекомендовать нечего.'
                : 'Скорости во всех участках в допустимых пределах: '
                    + Fmt.velocity(app.settings.minVelocity) + '…'
                    + Fmt.velocity(app.settings.maxVelocity) + ' м/с. Менять нечего.';
            box.appendChild(empty);
            byId('sizesApply').disabled = true;
            byId('sizesModal').className = 'modal';
            return;
        }

        byId('sizesApply').disabled = false;

        var table = document.createElement('table');
        var head = document.createElement('tr');
        ['', '№', 'Система', 'Роль', 'Длина, м', 'Материал', 'Ду сейчас',
         'v сейчас, м/с', 'Ду реком.', 'v станет, м/с', 'Почему'].forEach(function (title) {
            var th = document.createElement('th');
            th.textContent = title;
            head.appendChild(th);
        });
        table.appendChild(head);

        for (var i = 0; i < list.length; i++) {
            (function (item) {
                var tr = document.createElement('tr');

                var box1 = document.createElement('td');
                var tick = document.createElement('input');
                tick.type = 'checkbox';
                tick.checked = !!item.size;
                tick.disabled = !item.size;
                tick.dataset.index = item.index;
                tick.dataset.nominal = item.nominal;
                box1.appendChild(tick);
                tr.appendChild(box1);

                var cells = [
                    Fmt.int(item.index + 1),
                    item.segment.systemName || item.segment.zoneKey || '—',
                    item.segment.role === PipeRole.Supply ? 'Т3'
                        : (item.segment.role === PipeRole.Return ? 'Т4' : '—'),
                    Fmt.length(item.segment.length),
                    item.segment.material,
                    Fmt.fixed(item.segment.nominalDiameterMm, 0),
                    Fmt.velocity(item.segment.velocity),
                    Fmt.fixed(item.nominal, 0),
                    item.size ? Fmt.velocity(item.after) : '—',
                    item.size ? item.why
                        : 'у материала «' + item.segment.material + '» нет Ду '
                            + Fmt.fixed(item.nominal, 0) + ' — смените материал'
                ];

                for (var c = 0; c < cells.length; c++) {
                    var td = document.createElement('td');
                    td.textContent = cells[c];
                    if (!item.size) td.className = 'warn';
                    tr.appendChild(td);
                }

                table.appendChild(tr);
            })(list[i]);
        }

        box.appendChild(table);
        byId('sizesModal').className = 'modal';
    }

    function tickAllSizes(on) {
        var ticks = byId('sizesBody').querySelectorAll('input[type=checkbox]');
        for (var i = 0; i < ticks.length; i++) {
            if (!ticks[i].disabled) ticks[i].checked = on;
        }
    }

    function applySizes() {
        var ticks = byId('sizesBody').querySelectorAll('input[type=checkbox]');
        var changed = 0;
        var failed = 0;

        for (var i = 0; i < ticks.length; i++) {
            if (!ticks[i].checked || ticks[i].disabled) continue;

            var segment = app.network.segments[parseInt(ticks[i].dataset.index, 10)];
            var nominal = parseFloat(ticks[i].dataset.nominal);

            if (!segment) continue;

            if (Calc.applySize(segment, segment.material, nominal)) changed++;
            else failed++;
        }

        byId('sizesModal').className = 'modal hidden';

        if (changed === 0) {
            setStatus(failed > 0
                ? 'ни один диаметр не применился: таких размеров у материалов нет'
                : 'не отмечено ни одного участка', 'warn');
            return;
        }

        sayAfterRecalc('диаметров заменено: ' + changed
            + (failed > 0 ? ', не нашлось в каталоге: ' + failed : ''));

        // Один шаг отмены на всю пачку: человек нажал одну кнопку,
        // и отменяться это должно одним нажатием.
        app.afterEdit('рекомендуемые Ду');
    }

    // --- виды -----------------------------------------------------------------

    function renderPresets() {
        var box = byId('presets');
        box.innerHTML = '';

        for (var i = 0; i < ViewPresets.length; i++) {
            (function (preset) {
                var button = document.createElement('button');
                button.textContent = preset.key + ' ' + preset.name;
                button.title = 'Клавиша ' + preset.key;
                button.addEventListener('click', function () {
                    views['3d'].setPreset(preset);
                    markPreset(preset);
                });
                box.appendChild(button);
            })(ViewPresets[i]);
        }
    }

    function markPreset(preset) {
        var buttons = byId('presets').children;
        for (var i = 0; i < buttons.length; i++)
            buttons[i].className = ViewPresets[i] === preset ? 'active' : '';
    }

    function switchView(name) {
        app.activeView = name;

        byId('canvas3d').className = name === '3d' ? '' : 'hidden';
        byId('canvasFlat').className = name === 'flat' ? '' : 'hidden';
        byId('presets').className = name === '3d' ? 'presets' : 'presets hidden';
        byId('relayoutBtn').className = name === 'flat' ? '' : 'hidden';

        var buttons = document.querySelectorAll('.viewtabs button');
        for (var i = 0; i < buttons.length; i++)
            buttons[i].className = buttons[i].dataset.view === name ? 'active' : '';

        var view = views[name];
        if (!view.fitted) view.fit();
        else view.draw();

        view.canvas.focus();
    }

    function currentView() { return views[app.activeView]; }

    /*
        Подсказка по инструменту. Нужна прежде всего для ИТП: отметить надо ДВА
        узла — выход Т3 и вход Т4. Пока они не помечены оба, в графе нет ни одного
        цикла, и кольца не собираются вовсе. Догадаться об этом по одной кнопке
        нельзя, а цена ошибки — пустой расчёт.
    */
    var TOOL_HINTS = {
        select: '',
        pipeT3: 'Щелчок — первая точка, второй щелчок — вторая. Esc обрывает цепочку.',
        pipeT4: 'Щелчок — первая точка, второй щелчок — вторая. Esc обрывает цепочку.',
        link: 'Перемычка замыкает кольцо: соедините конец Т3 с концом Т4.',
        itp: 'Отметьте ДВА узла: откуда выходит Т3 и куда приходит Т4. Без пары кольцо не замкнётся.',
        valve: 'Щёлкните по участку — настройку клапана программа подберёт сама.',
        erase: 'Щелчок по участку или узлу удаляет его.'
    };

    function setTool(name) {
        views['3d'].tool = name;
        views.flat.tool = name;
        views['3d'].cancelDraft();
        views.flat.cancelDraft();

        if (TOOL_HINTS[name])
            setStatus(TOOL_HINTS[name], '');

        var buttons = byId('tools').children;
        for (var i = 0; i < buttons.length; i++) {
            var base = buttons[i].dataset.tool;
            buttons[i].className = (base === name ? 'active ' : '') + toolClass(base);
        }
    }

    function toolClass(name) {
        if (name === 'pipeT3') return 't3';
        if (name === 'pipeT4') return 't4';
        if (name === 'link') return 'link';
        if (name === 'itp') return 'itp';
        if (name === 'valve') return 'valve';
        if (name === 'erase') return 'erase';
        return '';
    }

    // --- файлы ----------------------------------------------------------------

    function openFile() {
        var input = byId('fileInput');
        input.value = '';
        input.dataset.mode = 'project';
        input.click();
    }

    function importFile() {
        var input = byId('fileInput');
        input.value = '';
        input.dataset.mode = 'revit';
        input.click();
    }

    function readFile(file, mode) {
        var reader = new FileReader();

        reader.onload = function () {
            var plain;
            try {
                plain = JSON.parse(reader.result);
            } catch (e) {
                alert('Файл не читается как JSON: ' + e.message);
                return;
            }

            try {
                if (mode === 'revit') {
                    var result = RevitImport.parse(plain, app.settings);
                    app.network = result.network;
                    app.projectName = result.name;
                    app.flatTouched = false;

                    // Разбор показывается сразу: если он неверен, все дальнейшие
                    // числа посчитаны не по тем трубам.
                    app.activeTable = 'diagnostics';
                    app.recalculate();

                    for (var i = 0; i < result.report.length; i++)
                        app.network.diagnostics.unshift(result.report[i]);

                    renderTabs();
                    renderTable();
                } else {
                    Storage.unpack(plain, app);
                    app.flatTouched = true;
                    app.recalculate();
                }

                // История начинается заново: шаги прежнего проекта к этому
                // отношения не имеют, а вернуться ими можно было бы в чужую сеть.
                History.reset(app);
                refreshHistoryButtons();

                byId('projectName').value = app.projectName;
                app.selection = null;
                fillTemplateControls();
                views['3d'].fit();
                views.flat.fit();
                renderLabels();
            } catch (e) {
                alert(e.message);
            }
        };

        reader.readAsText(file, 'utf-8');
    }

    function saveProject() {
        var name = (app.projectName || 'проект').replace(/[\\/:*?"<>|]/g, '-');
        Storage.download(name + '.json', JSON.stringify(Storage.pack(app), null, 1));
    }

    /*
        Пояснительная записка.

        Проверочный расчёт для неё считается здесь, а не берётся из app.proof:
        тот появляется только когда открыта его вкладка, а в записке раздел
        должен быть всегда. Расход берётся расчётный, положения клапанов —
        подобранные: предположения «что если» в документ, который подшивают
        в проект, попадать не должны.
    */
    function saveReport() {
        if (app.network.segments.length === 0) {
            setStatus('записку собирать не из чего: сеть пустая', 'warn');
            return;
        }

        var keptProof = app.proof;
        app.proof = ProofSolver.run(app.network, app.settings, {}, null);

        var images = [];
        if (app.network.nodes.length > 0) {
            images.push({ title: 'Принципиальная схема', dataUrl: views.flat.canvas.toDataURL('image/png') });
            images.push({ title: 'Трёхмерная схема', dataUrl: views['3d'].canvas.toDataURL('image/png') });
        }

        try {
            Report.save(app, images);
            setStatus('записка собрана: откройте файл в Word', 'done');
        } finally {
            app.proof = keptProof;
        }
    }

    /*
        Схема в DXF. Выгружается тот вид, который открыт: плоская схема идёт
        плоским чертежом, трёхмерная — настоящими трёхмерными линиями.

        Это не замена картинке, а другое назначение. Картинку вставляют
        в записку, DXF — в чертёж, и там она остаётся линиями, которые можно
        двигать, мерить и подписывать.
    */
    function saveDxf() {
        if (app.network.segments.length === 0) {
            setStatus('нечего выгружать: сеть пустая', 'warn');
            return;
        }

        var bytes = Dxf.build(app, app.activeView);
        var name = (app.projectName || 'схема').replace(/[\\/:*?"<>|]/g, '-');

        Storage.downloadBytes(
            name + (app.activeView === '3d' ? ' — 3D.dxf' : ' — схема.dxf'),
            bytes, 'image/vnd.dxf');

        setStatus('DXF выгружен: ' + Fmt.int(bytes.length / 1024) + ' КБ, '
            + 'единицы — миллиметры, кодировка CP1251', 'done');
    }

    function savePng() {
        var canvas = currentView().canvas;
        var name = (app.projectName || 'схема').replace(/[\\/:*?"<>|]/g, '-');

        canvas.toBlob(function (blob) {
            var url = URL.createObjectURL(blob);
            var link = document.createElement('a');
            link.href = url;
            link.download = name + (app.activeView === '3d' ? ' — 3D.png' : ' — схема.png');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        });
    }

    function copyTable() {
        var text = Tables.toText(app.activeTable, app);

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                setStatus('таблица скопирована', 'done');
            });
            return;
        }

        // Запасной путь: буфер обмена без разрешения доступен не всегда.
        var area = document.createElement('textarea');
        area.value = text;
        document.body.appendChild(area);
        area.select();
        try { document.execCommand('copy'); } catch (e) { }
        document.body.removeChild(area);
        setStatus('таблица скопирована', 'done');
    }

    function saveCsv() {
        // Разделитель — точка с запятой: в русской локали Excel запятая занята
        // под десятичный знак, и CSV с запятой он разложит в одну колонку.
        var text = Tables.toText(app.activeTable, app).split('\t').join(';');
        var name = Tables.titleOf(app.activeTable);

        // BOM обязателен: без него Excel читает файл в системной кодировке
        // и кириллица превращается в мусор.
        Storage.download(name + '.csv', '﻿' + text, 'text/csv');
    }

    function newProject() {
        if (!confirm('Начать новый проект? Несохранённое будет потеряно.')) return;

        app.network = new HwNetwork();
        app.projectName = 'Без названия';
        app.selection = null;
        app.zoneFilter = null;
        app.flatTouched = false;

        byId('projectName').value = app.projectName;
        Storage.forget();
        app.recalculate();
        History.reset(app);
        refreshHistoryButtons();
        views['3d'].fit();
        views.flat.fit();
    }

    // --- запуск ---------------------------------------------------------------

    function install() {
        views['3d'] = new SchemeView(byId('canvas3d'), '3d', app);
        views.flat = new SchemeView(byId('canvasFlat'), 'flat', app);

        var tools = byId('tools').children;
        for (var i = 0; i < tools.length; i++) {
            (function (button) {
                button.addEventListener('click', function () { setTool(button.dataset.tool); });
            })(tools[i]);
        }

        var viewButtons = document.querySelectorAll('.viewtabs button');
        for (i = 0; i < viewButtons.length; i++) {
            (function (button) {
                button.addEventListener('click', function () { switchView(button.dataset.view); });
            })(viewButtons[i]);
        }

        byId('projectName').addEventListener('change', function () {
            app.projectName = this.value || 'Без названия';
            Storage.autosave(app);
        });

        byId('zoneFilter').addEventListener('change', function () {
            app.zoneFilter = this.value || null;
            renderTable();
            drawAll();
        });

        byId('method').addEventListener('change', app.afterEdit);
        byId('run').addEventListener('click', app.recalculate);

        byId('tplZone').addEventListener('change', function () {
            if (this.value === '__new__') {
                var name = prompt('Имя новой системы, например «Т3.3 / Т4.3».\n'
                    + 'Достаточно номера зоны:', '3');
                if (!name) { this.value = app.template.zoneKey; return; }

                var key = 'Т#' + name.replace(/[^0-9]/g, '');
                app.network.zoneEnsure(key, 'Т3.' + name + ' / Т4.' + name);
                applyTemplateZone(key);
                fillTemplateZones();
                return;
            }
            applyTemplateZone(this.value);
        });

        byId('tplMaterial').addEventListener('change', function () {
            app.template.material = this.value;
            var first = PipeCatalog.first(this.value);
            if (first) app.template.nominalMm = first.nominalMm;
            fillTemplateSizes();
        });

        byId('tplSize').addEventListener('change', function () {
            app.template.nominalMm = parseFloat(this.value);
        });

        byId('tplInsulation').addEventListener('change', function () {
            app.template.insulationName = this.value;
        });

        byId('tplThickness').addEventListener('change', function () {
            app.template.insulationMm = parseFloat(this.value);
        });

        byId('tplLength').addEventListener('change', function () {
            var value = parseFloat(String(this.value).replace(',', '.'));
            if (isFinite(value) && value > 0) app.template.defaultLength = value;
        });

        byId('gridStep').addEventListener('change', function () {
            views['3d'].gridStep = parseFloat(this.value);
            views.flat.gridStep = parseFloat(this.value);
            drawAll();
        });

        byId('planeOffset').addEventListener('change', function () {
            var value = parseFloat(String(this.value).replace(',', '.'));
            views['3d'].planeOffset = isFinite(value) ? value : 0;
            views['3d'].draw();
        });

        byId('showGrid').addEventListener('change', function () {
            views['3d'].showGrid = this.checked;
            views.flat.showGrid = this.checked;
            drawAll();
        });

        byId('labelsToggle').addEventListener('click', function () {
            var on = LabelOptions.anyOn();
            LabelOptions.setAll(!on);
            this.textContent = on ? 'включить все' : 'снять все';
            renderLabels();
            drawAll();
        });

        var colour = byId('colourMode');
        for (i = 0; i < ColourModes.length; i++)
            colour.appendChild(option(ColourModes[i].key, ColourModes[i].name));
        colour.value = app.colourMode;

        colour.addEventListener('change', function () {
            app.colourMode = this.value;
            renderLegend();
            drawAll();
        });

        byId('proofFlow').addEventListener('change', function () { renderTable(); });
        byId('proofFlow').addEventListener('input', function () { renderTable(); });
        // Сброс возвращает вкладку к расчётному состоянию целиком: и расход
        // на ИТП, и все выставленные руками положения клапанов.
        byId('proofReset').addEventListener('click', function (e) {
            e.preventDefault();
            byId('proofFlow').value = '';
            app.proofPositions = {};
            renderTable();
        });

        byId('roleFilter').addEventListener('change', function () {
            Tables.roleFilter = this.value;
            renderTable();
        });

        byId('fitBtn').addEventListener('click', function () { currentView().fit(); });
        byId('pngBtn').addEventListener('click', savePng);
        byId('dxfBtn').addEventListener('click', saveDxf);
        byId('reportBtn').addEventListener('click', saveReport);

        byId('relayoutBtn').addEventListener('click', function () {
            app.flatTouched = false;
            if (app.network.rings.length > 0) AutoLayout.build(app.network);
            else AutoLayout.buildRough(app.network);
            views.flat.fit();
        });

        /*
            Замыкание близких концов вручную, по кнопке, а не само собой.

            Само собой было бы удобнее ровно один раз, а мешало бы постоянно:
            начатая труба, ещё не дотянутая до места, тут же прилипала бы к соседней.
            Поэтому решение остаётся за человеком, а программа лишь называет места
            в диагностике.
        */
        byId('closeEndsBtn').addEventListener('click', function () {
            var radius = Math.min(2.0, app.settings.linkToleranceMm / 1000.0 * 25.0);
            var pairs = NetworkEdit.findCandidates(app.network, radius);

            var closed = 0;
            var taken = {};

            for (var i = 0; i < pairs.length; i++) {
                var pair = pairs[i];
                if (pair.sameSystem) continue;                  // это разрыв, а не замыкание
                if (taken[pair.a.node] || taken[pair.b.node]) continue;

                var supply = pair.a.role === PipeRole.Supply ? pair.a : pair.b;
                var ret = pair.a.role === PipeRole.Supply ? pair.b : pair.a;
                if (supply.role !== PipeRole.Supply || ret.role !== PipeRole.Return) continue;

                taken[pair.a.node] = true;
                taken[pair.b.node] = true;

                NetworkEdit.addRingClosure(app.network, supply.node, ret.node,
                    supply.zoneKey || app.template.zoneKey);
                closed++;
            }

            if (closed === 0) {
                setStatus('близких пар Т3 и Т4 не нашлось — нарисуйте перемычку вручную', 'warn');
                return;
            }

            app.afterEdit('замыкание близких концов');
            setStatus('замкнуто перемычек: ' + closed, 'done');
        });

        /*
            Узлы в примыканиях — для того, что уже начерчено или пришло из модели.
            При черчении узел ставится сам, когда линия дотягивается до трубы,
            но подводка, упёршаяся в магистраль давно, так и осталась без него:
            на схеме линии пересекаются, а в графе это два несвязанных куска.
        */
        byId('splitTouchBtn').addEventListener('click', function () {
            var tolerance = app.settings.linkToleranceMm / 1000.0;
            var made = NetworkEdit.splitAtTouchingNodes(app.network, tolerance);

            if (made === 0) {
                setStatus('примыканий без узла не нашлось (допуск '
                    + Fmt.num(app.settings.linkToleranceMm) + ' мм)', 'warn');
                return;
            }

            app.afterEdit('узлы в примыканиях');
            setStatus('поставлено узлов: ' + made, 'done');
        });

        byId('copyBtn').addEventListener('click', copyTable);
        byId('csvBtn').addEventListener('click', saveCsv);

        byId('dockToggle').addEventListener('click', function () {
            var dock = document.querySelector('.dock');
            var collapsed = dock.className.indexOf('collapsed') >= 0;
            dock.className = collapsed ? 'dock' : 'dock collapsed';
            this.textContent = collapsed ? 'свернуть' : 'развернуть';
            setTimeout(drawAll, 0);
        });

        byId('undoBtn').addEventListener('click', undo);
        byId('redoBtn').addEventListener('click', redo);

        byId('propsBtn').addEventListener('click', openProps);
        byId('propsApply').addEventListener('click', applyProps);
        byId('propsCancel').addEventListener('click', function () {
            byId('propsModal').className = 'modal hidden';
        });

        byId('sizesBtn').addEventListener('click', openSizes);
        byId('sizesApply').addEventListener('click', applySizes);
        byId('sizesAll').addEventListener('click', function () { tickAllSizes(true); });
        byId('sizesNone').addEventListener('click', function () { tickAllSizes(false); });
        byId('sizesCancel').addEventListener('click', function () {
            byId('sizesModal').className = 'modal hidden';
        });

        byId('settingsBtn').addEventListener('click', openSettings);
        byId('modalClose').addEventListener('click', closeSettings);
        byId('openBtn').addEventListener('click', openFile);
        byId('importBtn').addEventListener('click', importFile);
        byId('saveBtn').addEventListener('click', saveProject);
        byId('newBtn').addEventListener('click', newProject);

        byId('fileInput').addEventListener('change', function () {
            if (this.files && this.files[0]) readFile(this.files[0], this.dataset.mode);
        });

        // Перетаскивание файла на окно — тот же импорт, только без диалога.
        window.addEventListener('dragover', function (e) { e.preventDefault(); });
        window.addEventListener('drop', function (e) {
            e.preventDefault();
            if (!e.dataTransfer.files || !e.dataTransfer.files[0]) return;

            var file = e.dataTransfer.files[0];
            readFile(file, 'auto');
        });

        window.addEventListener('resize', function () { drawAll(); });

        document.addEventListener('keydown', function (e) {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT'))
                return;

            // Ctrl+Z и Ctrl+Y — привычные всем, отдельно Ctrl+Shift+Z:
            // в части программ возврат делают именно им.
            if (e.ctrlKey || e.metaKey) {
                var key = e.key.toLowerCase();

                if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
                if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
                return;
            }

            if (e.key === 'Escape') setTool('select');
        });

        // Плоскую схему человек мог разложить сам — тогда автораскладка
        // перестаёт её трогать: он поставил узлы туда, куда хотел.
        views.flat.canvas.addEventListener('mouseup', function () {
            if (views.flat.drag && views.flat.drag.kind === 'node') app.flatTouched = true;
        });

        fillTemplateControls();
        renderPresets();
        renderLabels();
        renderLegend();
        renderTabs();
        switchView('3d');
        markPreset(ViewPresets[7]);

        if (Storage.restore(app)) {
            byId('projectName').value = app.projectName;
            fillTemplateControls();
            renderLabels();
            app.flatTouched = true;
        }

        app.recalculate();
        History.reset(app);
        refreshHistoryButtons();
        views['3d'].fit();
        views.flat.fit();
    }

    /* Разбор автоматический: файл проекта и выгрузка из Revit различаются полем «формат». */
    var originalRead = readFile;
    readFile = function (file, mode) {
        if (mode !== 'auto') { originalRead(file, mode); return; }

        var reader = new FileReader();
        reader.onload = function () {
            var plain;
            try { plain = JSON.parse(reader.result); }
            catch (e) { alert('Файл не читается как JSON: ' + e.message); return; }

            originalRead(file, plain['формат'] === 'ГВС-Циркуляция' ? 'project' : 'revit');
        };
        reader.readAsText(file, 'utf-8');
    };

    document.addEventListener('DOMContentLoaded', install);
    return app;
})();
