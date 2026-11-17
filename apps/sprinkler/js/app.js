'use strict';

/*
    Сборка программы: книга объекта, переключение систем, пересчёт после
    правки, файлы и подложка.

    Любая правка идёт одной дорогой — App.afterEdit(подпись): модель уже
    изменена, дальше пересчёт, шаг отмены, автосохранение и перерисовка.
    Для системы АПТ это план с оросителями, для ВПВ — стояки.
*/

var App = (function () {

    var app = {
        book: null,
        project: null,
        net: null,
        calc: null,
        selection: null,
        hoverSeg: null,
        mode: 'apt'
    };

    var statusTimer = null;

    function $(id) { return document.getElementById(id); }

    function isField(el) {
        return el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
    }

    app.system = function () {
        return Systems.active(app.book);
    };

    app.recompute = function () {
        if (app.mode !== 'apt' || !app.project) return;
        app.net = Solver.solve(app.project);
        app.calc = Calc.build(app.project, app.net);
    };

    /** Выделение, которое после правки указывает в пустоту, снимается. */
    function validateSelection() {
        var sel = app.selection;
        var p = app.project;
        if (!sel || !p) return;

        if (sel.type === 'node' && !Model.node(p, sel.id)) app.selection = null;
        else if (sel.type === 'seg' && !Model.seg(p, sel.id)) app.selection = null;
        else if (sel.type === 'branch') {
            var br = Model.seg(p, sel.seg) ? Model.branchOf(p, sel.seg) : null;
            if (br) sel.branch = br;
            else app.selection = null;
        }
    }

    function updateHistoryButtons() {
        var undo = $('undoBtn');
        var redo = $('redoBtn');
        undo.disabled = !History.canUndo();
        redo.disabled = !History.canRedo();
        undo.title = History.canUndo() ? 'Отменить: ' + History.undoLabel() + ' (Ctrl+Z)' : 'Отменять нечего';
        redo.title = History.canRedo() ? 'Вернуть: ' + History.redoLabel() + ' (Ctrl+Y)' : 'Возвращать нечего';
    }

    app.refresh = function () {
        Systems.renderSelect();
        if (app.mode === 'apt') {
            View.render();
            Panels.refresh();
            if (app.plan) planSummary();
        } else if (app.mode === 'vpv') {
            VpvUI.refresh();
        } else if (app.mode === 'floors') {
            FloorsUI.refresh();
        } else if (app.mode === 'scheme') {
            SchemeUI.refresh();
        } else if (app.mode === 'task') {
            TaskUI.refresh();
        } else {
            TchUI.refresh();
        }
        updateHistoryButtons();
    };

    /*
        В плане этажа своя сводка: сколько нужно сети этажа у врезки и чем
        кончается весь стояк. Напор «по плану» с его вводом здесь сбивал бы с толку.
    */
    function planSummary() {
        var sys = Systems.find(app.book, app.plan.sys);
        if (!sys || !sys.floors) return;

        var res = Floors.solve(sys.floors, app.book);
        var ps = res.plans[app.plan.plan];
        var k = sys.floors.inlet.localFactor;
        var html = '<span>План этажа «' + Fmt.html(app.plan.name) + '»</span>';

        if (ps && ps.ok) {
            html += '<span>Q <b>' + Fmt.num(ps.Q, 2) + '</b> л/с</span>'
                + '<span>у врезки <b>' + Fmt.num(ps.Hfree + ps.HnetRaw * k, 2) + '</b> м</span>';
        } else {
            html += '<span class="warn">' + Fmt.html(ps ? ps.errors.join(' ') : 'план не считается') + '</span>';
        }
        if (res.ok) {
            html += '<span>стояк ' + Fmt.html(sys.code) + ': Нтр <b>' + Fmt.num(res.dict.Htr, 2) + '</b> м, Нр <b>'
                + Fmt.num(res.pumpHead, 2) + '</b> м</span>';
        }

        var warn = app.warnings();
        if (warn.length) {
            html += '<span class="warn" title="' + Fmt.html(warn.join('\n')) + '">замечаний: ' + warn.length + '</span>';
        }

        $('summary').innerHTML = html;
    }

    /*
        Запомнить книгу: быстрый запас в памяти браузера и рабочая копия объекта
        в библиотеке. В автосохранение тяжёлое не влезает (каталожные листы,
        подложки, чертежи), в библиотеку — влезает: там IndexedDB.
    */
    app.remember = function () {
        Storage.autosave(app.book);
        if (window.Library && Library.isReady()) Library.touch(app.book);
    };

    app.afterEdit = function (label) {
        if (app.mode === 'apt') {
            validateSelection();
            app.recompute();
        }
        History.record(app, label);
        app.remember();
        app.refresh();
    };

    app.select = function (sel) {
        app.selection = sel;
        validateSelection();
        app.refresh();
    };

    var VPV_HINT = 'Вводите данные слева — схема и расчёт обновляются сразу.';

    /** Подсказки инструментов плана (без kind) идут только в строку АПТ. */
    app.status = function (text, kind) {
        var hints = { vpv: 'vpvHint', floors: 'flrHint', tch: 'tchHint' };
        var el = $(kind && app.mode !== 'apt' ? hints[app.mode] : 'hint');
        el.textContent = text || '';
        el.className = 'hint-line' + (kind ? ' ' + kind : '');

        clearTimeout(statusTimer);
        if (kind) {
            statusTimer = setTimeout(function () {
                $('hint').textContent = Tools.hint();
                $('hint').className = 'hint-line';
                $('vpvHint').textContent = VPV_HINT;
                $('vpvHint').className = 'hint-line';
            }, 7000);
        }
    };

    /**
        Печать. Поля страницы в печатной вёрстке нулевые, поэтому браузер сам
        убирает свои колонтитулы с путём к файлу, фамилией и датой: рисовать их
        негде. Отступ 10 мм лист держит сам — боковые полями ячейки, верхний и
        нижний пустыми шапкой и подвалом рамки: их браузер повторяет на каждой
        странице, поэтому отступ одинаковый на всех листах, а не только на первом.
    */
    app.print = function () {
        var area = $('printArea');
        if (area.innerHTML && !area.querySelector('.print-frame')) {
            area.innerHTML = '<table class="print-frame"><thead><tr><td></td></tr></thead>'
                + '<tbody><tr><td>' + area.innerHTML + '</td></tr></tbody>'
                + '<tfoot><tr><td></td></tr></tfoot></table>';
        }
        app.status('Поля в окне печати — «Нет» или «По умолчанию»: отступ 10 мм лист держит сам, '
            + 'а дату, путь к файлу и номера страниц браузер тогда не печатает.');
        window.print();
    };

    /* --- замечания расчёта ------------------------------------------------ */

    /** Замечания того рабочего места, которое открыто сейчас (и общие по книге). */
    app.warnings = function () {
        return Appendix.warnings(app.book).concat(Tch.dataWarnings(app.book), placeWarnings());
    };

    function placeWarnings() {
        if (app.mode === 'apt') {
            var list = ((app.net && app.net.warnings) || []).concat((app.calc && app.calc.warnings) || []);

            // В плане этажа к замечаниям плана добавляются замечания всего стояка.
            if (app.plan) {
                var sys = Systems.find(app.book, app.plan.sys);
                if (sys && sys.floors) {
                    var res = Floors.solve(sys.floors, app.book);
                    list = list.concat(res.errors, res.warnings.map(function (w) { return 'Стояк ' + sys.code + ': ' + w; }));
                }
            }
            return list;
        }
        if (app.mode === 'vpv') {
            var v = VpvUI.last();
            return v ? v.warnings.concat(v.errors) : [];
        }
        if (app.mode === 'floors') {
            var f = FloorsUI.last();
            return f ? f.warnings.concat(f.errors) : [];
        }
        return [];
    };

    /** Окно со списком замечаний — по щелчку на «замечаний: N» в шапке. */
    app.showWarnings = function () {
        var list = app.warnings();
        var root = $('modalRoot');

        if (!list.length) {
            app.status('Замечаний нет.', 'done');
            return;
        }

        root.innerHTML = '<div class="modal" data-close="1"><div class="sheet warn-sheet">'
            + '<h2>Замечания расчёта</h2>'
            + '<ul class="warnings">' + list.map(function (w) { return '<li>' + Fmt.html(w) + '</li>'; }).join('') + '</ul>'
            + '<p class="hint">Тот же список — вверху вкладки «Расчёт». Замечания не мешают выгрузке: это предупреждения, '
            + 'а не запрет.</p>'
            + '<div class="sheet-buttons"><button data-close="1" class="primary">Понятно</button></div>'
            + '</div></div>';
    };

    /** Одно рабочее место видно, остальные скрыты. */
    function show(id) {
        ['aptMain', 'vpvMain', 'flrMain', 'tchMain', 'schMain', 'taskMain'].forEach(function (name) {
            $(name).hidden = name !== id;
        });
        $('backToRiser').hidden = !app.plan;
        if (app.plan) {
            var sys = Systems.find(app.book, app.plan.sys);
            $('backToRiser').textContent = '← Стояк ' + (sys ? sys.code : '') + ' · план «' + app.plan.name + '»';
        }
    }

    /** Сделать систему активной: рабочее место АПТ или ВПВ. */
    app.activate = function (id, keepView) {
        var book = app.book;
        var sys = Systems.find(book, id) || book.systems[0];

        book.active = sys.id;
        Tools.cancel();
        PumpWindow.close();
        app.selection = null;
        app.hoverSeg = null;
        app.plan = null;

        if (sys.kind === 'floors') {
            app.mode = 'floors';
            show('flrMain');
        } else if (sys.kind === 'apt' || sys.kind === 'vpvplan') {
            app.mode = 'apt';
            app.project = sys.project;
            app.project.settings.systemName = sys.code;
            app.project.name = Systems.fileBase(book, sys);
            show('aptMain');
            app.recompute();
            View.resize();
            if (!keepView) View.fit();
        } else {
            app.mode = 'vpv';
            show('vpvMain');
        }

        app.refresh();
    };

    /**
        План этажа системы «АПТ по этажам» открывается в обычном редакторе АПТ.
        Точка «Ввод» на нём — врезка в стояк; напоры и насосная считаются на
        схеме стояка, куда ведёт кнопка «← Стояк».
    */
    app.openPlan = function (sysId, planId, keepView) {
        var book = app.book;
        var sys = Systems.find(book, sysId);
        var plan = sys && sys.floors ? Floors.findPlan(sys.floors, planId) : null;
        if (!plan) {
            app.activate(sysId, keepView);
            return;
        }

        book.active = sys.id;
        Tools.cancel();
        PumpWindow.close();
        app.selection = null;
        app.hoverSeg = null;

        app.mode = 'apt';
        app.plan = { sys: sys.id, plan: plan.id, name: plan.name };
        app.project = plan.project;
        app.project.settings.systemName = sys.code;
        app.project.name = Systems.fileBase(book, sys) + ' ' + plan.name;

        show('aptMain');
        app.recompute();
        View.resize();
        if (!keepView) View.fit();
        app.refresh();

        if (!keepView) {
            app.status('План этажа «' + plan.name + '» системы ' + sys.code + ': «Ввод» — врезка в стояк. '
                + 'Отметки, стояк и насосная задаются на схеме стояка.', 'done');
        }
    };

    /** Текстовая часть — рабочее место объекта, а не отдельной системы. */
    app.showText = function () {
        Tools.cancel();
        app.plan = null;
        app.mode = 'tch';
        show('tchMain');
        app.refresh();
    };

    /** Принципиальная схема: лист собирается из расчёта всей книги. */
    app.showScheme = function () {
        Tools.cancel();
        PumpWindow.close();
        app.plan = null;
        app.mode = 'scheme';
        show('schMain');
        app.refresh();
        app.status('Лист собран из расчёта. «Выгрузить DXF…» — файл для AutoCAD, «Печать / PDF» — лист на бумагу.');
    };

    /** Задание для ЭЛ и СС — тоже рабочее место книги, а не системы. */
    app.showTask = function () {
        Tools.cancel();
        PumpWindow.close();
        app.plan = null;
        app.mode = 'task';
        show('taskMain');
        app.refresh();
        app.status('Позиции собраны из книги. Марки и мощности берутся из каталожных листов насосов.');
    };

    app.load = function (book) {
        app.book = book;
        $('projectName').value = book.object.name;
        History.reset(app);
        app.activate(book.active);
        History.reset(app);
        app.remember();
    };

    /** Снимок помнит систему, открытую тогда; остаёмся на нынешней, если она уцелела. */
    function afterHistory(current, label, verb) {
        if (!label) return;
        $('projectName').value = app.book.object.name;
        // В записке отмена оставляет в записке (и в окне насосов, если оно открыто).
        if (app.mode === 'tch') app.showText();
        else if (app.mode === 'scheme') app.showScheme();
        else if (app.mode === 'task') app.showTask();
        else if (app.plan) app.openPlan(app.plan.sys, app.plan.plan, true);
        else app.activate(Systems.find(app.book, current) ? current : app.book.active, true);
        app.remember();
        app.status(verb + ': ' + label, 'done');
    }

    app.undo = function () {
        Tools.cancel();
        var current = app.book.active;
        afterHistory(current, History.undo(app), 'Отменено');
    };

    app.redo = function () {
        Tools.cancel();
        var current = app.book.active;
        afterHistory(current, History.redo(app), 'Возвращено');
    };

    app.save = function () {
        Storage.download(app.book);
        app.status('Проект сохранён в файл.', 'done');
    };

    function loadUnderlay(file) {
        if (!file || app.mode !== 'apt') return;

        if (!/^image\//.test(file.type)) {
            app.status('Подложка — картинка PNG или JPG. PDF сначала сохраните картинкой.', 'warn');
            return;
        }

        var reader = new FileReader();
        reader.onload = function () {
            var img = new Image();
            img.onload = function () {
                var size = View.size();
                var centre = View.toWorld(size.width / 2, size.height / 2);
                var old = app.project.underlay;
                var scale = old && old.scale ? old.scale : 60 / img.naturalWidth;

                app.project.underlay = {
                    id: 'u' + Date.now(),
                    name: file.name || 'из буфера',
                    src: reader.result,
                    w: img.naturalWidth,
                    h: img.naturalHeight,
                    scale: scale,
                    x: old ? old.x : centre.x - img.naturalWidth * scale / 2,
                    y: old ? old.y : centre.y - img.naturalHeight * scale / 2,
                    opacity: old && old.opacity ? old.opacity : 0.6,
                    visible: true
                };

                app.afterEdit('подложка');
                if (!old) View.fit();

                app.status(old
                    ? 'Подложка заменена, масштаб и положение прежние.'
                    : 'Подложка загружена. Задайте масштаб: кнопка «Масштаб» и два щелчка по известному размеру.', 'done');
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    }

    /* --- чертёж DXF -------------------------------------------------------- */

    /*
        Чертёж из AutoCAD ложится подложкой: читается пространство модели,
        масштаб задаётся при вставке (сколько метров в единице чертежа), дальше
        чертёж двигается мышью. Размеры по нему не считаются — это только фон,
        по которому удобно ставить оросители.
    */
    /** Пунктов в метре на листе: 1 пункт = 1/72 дюйма. */
    var POINT_M = 0.0254 / 72;

    function loadDrawing(file) {
        if (!file || app.mode !== 'apt') return;
        if (/\.pdf$/i.test(file.name)) loadPdf(file);
        else loadDxf(file);
    }

    /*
        PDF берётся не картинкой, а линиями: план, напечатанный из AutoCAD или
        Revit, лежит внутри векторными путями. Масштаб задаётся листом — 1:100
        значит, что пункт листа равен 100 пунктам натуры.
    */
    function loadPdf(file) {
        app.status('Читаю чертёж ' + file.name + '…');

        var reader = new FileReader();
        reader.onerror = function () { app.status('Файл не прочитался.', 'warn'); };
        reader.onload = function () {
            Pdf.open(reader.result).then(function (doc) {
                if (!doc.pages.length) {
                    app.status('В файле не нашлось страниц — возможно, PDF зашифрован.', 'warn');
                    return;
                }
                askPdfScale(file.name, doc);
            }).catch(function (e) {
                app.status('Чертёж не разобрался: ' + (e && e.message ? e.message : e), 'warn');
            });
        };
        reader.readAsArrayBuffer(file);
    }

    function askPdfScale(name, doc) {
        var pages = doc.pages.map(function (p, i) {
            return '<option value="' + i + '">Страница ' + (i + 1) + ' — '
                + Fmt.num(p.w * POINT_M * 1000, 0) + ' × ' + Fmt.num(p.h * POINT_M * 1000, 0) + ' мм</option>';
        }).join('');

        var scales = [50, 75, 100, 200, 250, 500].map(function (s) {
            return '<option value="' + s + '"' + (s === 100 ? ' selected' : '') + '>1 : ' + s + '</option>';
        }).join('');

        $('modalRoot').innerHTML = '<div class="modal" data-close="1"><div class="sheet dxf-sheet">'
            + '<h2>Чертёж ' + Fmt.html(name) + '</h2>'
            + '<p class="hint">Страниц в файле: ' + doc.pages.length + '. Чертёж читается линиями, как в DXF: '
            + 'растровые сканы так не подгрузятся — их кладут «Подложкой…» картинкой.</p>'
            + (doc.pages.length > 1
                ? '<label class="field"><span>Страница</span><select id="pdfPage">' + pages + '</select></label>'
                : '<input type="hidden" id="pdfPage" value="0">')
            + '<label class="field"><span>Масштаб чертежа</span><select id="pdfScale">' + scales + '</select></label>'
            + '<label class="field"><span>Метров в пункте листа (если масштаб нестандартный)</span>'
            + '<input id="dxfFactor" type="text" inputmode="decimal" value="' + Fmt.trim(100 * POINT_M, 8) + '"></label>'
            + '<p class="hint" id="dxfSize"></p>'
            + '<div class="sheet-buttons"><button data-close="1">Отмена</button>'
            + '<button id="pdfOk" class="primary">Вставить</button></div>'
            + '</div></div>';

        var factorInput = $('dxfFactor');
        var scaleSelect = $('pdfScale');
        var pageSelect = $('pdfPage');

        function size() {
            var f = Fmt.parse(factorInput.value);
            var page = doc.pages[Number(pageSelect.value) || 0];
            $('dxfSize').textContent = f > 0
                ? 'Лист целиком получится ' + Fmt.num(page.w * f, 2) + ' × ' + Fmt.num(page.h * f, 2)
                    + ' м; на плане останется только то, что начерчено.'
                : 'Укажите, сколько метров в одном пункте листа.';
        }

        scaleSelect.addEventListener('change', function () {
            factorInput.value = Fmt.trim(Number(this.value) * POINT_M, 8);
            size();
        });
        factorInput.addEventListener('input', size);
        if (pageSelect.tagName === 'SELECT') pageSelect.addEventListener('change', size);
        size();

        $('pdfOk').addEventListener('click', function () {
            var f = Fmt.parse(factorInput.value);
            if (!(f > 0)) {
                app.status('Множитель должен быть больше нуля.', 'warn');
                return;
            }

            var page = doc.pages[Number(pageSelect.value) || 0];
            $('modalRoot').innerHTML = '';
            app.status('Разбираю страницу…');

            Pdf.geometry(doc.doc, page.num).then(function (g) {
                if (!g.ents.length) {
                    app.status('На странице не нашлось линий: похоже, это скан или картинка. '
                        + 'Такой лист кладут «Подложкой…» картинкой и калибруют кнопкой «Масштаб».', 'warn');
                    return;
                }
                putDrawing(name, { ents: g.ents, bounds: Dxf.bounds(g.ents), cut: g.cut }, f);
            }).catch(function (e) {
                app.status('Чертёж не разобрался: ' + (e && e.message ? e.message : e), 'warn');
            });
        });
    }

    function loadDxf(file) {
        if (!file || app.mode !== 'apt') return;

        if (/\.dwg$/i.test(file.name)) {
            app.status('Файл .dwg не читается: это закрытый двоичный формат Autodesk. Откройте его в AutoCAD '
                + '(или в бесплатном DWG TrueView) и сохраните как DXF: «Сохранить как → Чертёж AutoCAD (*.dxf)». '
                + 'Если план лежит внешней ссылкой, перед этим вставьте её в чертёж (ССВСТАВИТЬ / _XREF → Вставить).', 'warn');
            return;
        }

        app.status('Читаю чертёж ' + file.name + '…');

        var reader = new FileReader();
        reader.onerror = function () { app.status('Файл не прочитался.', 'warn'); };
        reader.onload = function () {
            var parsed;
            try {
                parsed = Dxf.parse(String(reader.result));
            } catch (e) {
                app.status('Чертёж не разобрался: ' + e.message, 'warn');
                return;
            }
            if (!parsed.ok) {
                app.status(parsed.error, 'warn');
                return;
            }
            if (!parsed.ents.length) {
                app.status('В пространстве модели не нашлось линий: возможно, план лежит на листе или во внешней ссылке.', 'warn');
                return;
            }
            askDxfScale(file.name, parsed);
        };
        reader.readAsText(file, 'utf-8');
    }

    function askDxfScale(name, parsed) {
        var unit = parsed.unit || Dxf.unitOf(4);
        var w = parsed.bounds.x1 - parsed.bounds.x0;
        var h = parsed.bounds.y1 - parsed.bounds.y0;
        var skipped = Dxf.skippedText(parsed);

        var options = Dxf.UNITS.map(function (u) {
            return '<option value="' + u.factor + '"' + (u.code === unit.code ? ' selected' : '') + '>'
                + Fmt.html(u.name) + ' (1 ед. = ' + Fmt.trim(u.factor, 4) + ' м)</option>';
        }).join('');

        $('modalRoot').innerHTML = '<div class="modal" data-close="1"><div class="sheet dxf-sheet">'
            + '<h2>Чертёж ' + Fmt.html(name) + '</h2>'
            + '<p class="hint">Объектов из модели: ' + parsed.ents.length
            + '; габарит в единицах чертежа: ' + Fmt.num(w, 1) + ' × ' + Fmt.num(h, 1) + '.'
            + (parsed.unit ? ' В файле записаны ' + Fmt.html(parsed.unit.name) + '.' : ' Единицы в файле не указаны — выберите сами.')
            + (parsed.cut ? ' Чертёж очень большой: часть объектов пропущена.' : '')
            + (skipped ? ' Не читаются: ' + Fmt.html(skipped) + '.' : '')
            + '</p>'
            + '<label class="field"><span>Единица чертежа</span><select id="dxfUnit">' + options + '</select></label>'
            + '<label class="field"><span>Метров в единице чертежа</span>'
            + '<input id="dxfFactor" type="text" inputmode="decimal" value="' + Fmt.trim(unit.factor, 6) + '"></label>'
            + '<p class="hint" id="dxfSize"></p>'
            + '<p class="hint">Берётся пространство модели; листы и штампы пропускаются. Чертёж ложится фоном: '
            + 'его можно двигать кнопкой «Сдвинуть чертёж», расчёт он не меняет.</p>'
            + '<div class="sheet-buttons"><button data-close="1">Отмена</button>'
            + '<button id="dxfOk" class="primary">Вставить</button></div>'
            + '</div></div>';

        var factorInput = $('dxfFactor');
        var unitSelect = $('dxfUnit');

        function size() {
            var f = Fmt.parse(factorInput.value);
            $('dxfSize').textContent = f > 0
                ? 'План получится ' + Fmt.num(w * f, 2) + ' × ' + Fmt.num(h * f, 2) + ' м.'
                : 'Укажите, сколько метров в одной единице чертежа.';
        }

        unitSelect.addEventListener('change', function () {
            factorInput.value = Fmt.trim(Number(this.value), 6);
            size();
        });
        factorInput.addEventListener('input', size);
        size();

        $('dxfOk').addEventListener('click', function () {
            var f = Fmt.parse(factorInput.value);
            if (!(f > 0)) {
                app.status('Множитель должен быть больше нуля.', 'warn');
                return;
            }
            $('modalRoot').innerHTML = '';
            putDrawing(name, parsed, f);
        });
    }

    function putDrawing(name, parsed, factor) {
        var placed = Dxf.place(parsed, factor);
        var old = app.project.dxf;
        var view = View.size();
        var centre = View.toWorld(view.width / 2, view.height / 2);

        app.project.dxf = {
            name: name,
            factor: factor,
            x: old ? old.x : centre.x - placed.w / 2,
            y: old ? old.y : centre.y - placed.h / 2,
            w: placed.w,
            h: placed.h,
            visible: true,
            ents: placed.ents
        };

        app.afterEdit('чертёж DXF');
        if (!old) View.fit();

        var points = placed.ents.reduce(function (sum, e) { return sum + (e.v ? e.v.length : 4); }, 0);
        app.status('Чертёж вставлен: ' + Fmt.num(placed.w, 2) + ' × ' + Fmt.num(placed.h, 2) + ' м, объектов '
            + placed.ents.length + '. Двигать — «Сдвинуть чертёж».'
            + (points > 400000 ? ' Чертёж тяжёлый: в память браузера он может не поместиться, сохраните проект в файл.' : ''), 'done');
    }

    function init() {
        View.init($('plan'));
        Tools.init();
        Panels.init();
        VpvUI.init();
        FloorsUI.init();
        TchUI.init();
        SchemeUI.init();
        TaskUI.init();
        RequestUI.init();
        PumpWindow.init();
        Systems.init();

        $('projectName').addEventListener('change', function () {
            app.book.object.name = this.value.trim() || 'Без названия';
            var sys = app.system();
            if (sys && sys.project) sys.project.name = Systems.fileBase(app.book, sys);
            app.afterEdit('название');
        });

        // «замечаний: N» в шапке — щелчок открывает их списком.
        $('summary').addEventListener('click', function (e) {
            if (e.target.closest('.warn')) app.showWarnings();
        });

        // Окно замечаний закрывается кнопкой и щелчком мимо листа.
        $('modalRoot').addEventListener('click', function (e) {
            var close = e.target.closest('[data-close]');
            if (close && (close.tagName === 'BUTTON' || e.target === close)) $('modalRoot').innerHTML = '';
        });

        $('undoBtn').addEventListener('click', app.undo);
        $('redoBtn').addEventListener('click', app.redo);
        $('saveBtn').addEventListener('click', app.save);

        $('openBtn').addEventListener('click', function () { $('fileInput').click(); });
        $('fileInput').addEventListener('change', function () {
            var file = this.files[0];
            this.value = '';
            if (!file) return;

            /*
                С библиотекой файл заводится отдельным объектом: открытая работа
                остаётся на месте, а не затирается. Без библиотеки — как раньше.
            */
            if (window.Library && Library.isReady()) {
                LibraryUI.openFile(file);
                return;
            }

            Storage.read(file, function (book) {
                app.load(book);
                app.status('Открыт проект «' + book.object.name + '».', 'done');
            }, function (e) {
                app.status('Не удалось открыть: ' + (e && e.message ? e.message : e), 'warn');
            });
        });

        $('newBtn').addEventListener('click', function () {
            // Новый объект библиотеки: прежний никуда не девается.
            if (window.Library && Library.isReady()) {
                LibraryUI.newObject();
                return;
            }

            if (!window.confirm('Начать новый проект? Текущий останется только в сохранённом файле.')) return;
            var base = null;
            app.book.systems.forEach(function (s) { if (!base && s.project) base = s.project.settings; });
            app.load(Storage.newBook(base));
        });

        $('underlayBtn').addEventListener('click', function () {
            if (app.mode !== 'apt') {
                app.status('Подложка есть только у систем АПТ.', 'warn');
                return;
            }
            $('underlayInput').click();
        });
        $('underlayInput').addEventListener('change', function () {
            loadUnderlay(this.files[0]);
            this.value = '';
        });

        $('ulOpacity').addEventListener('input', function () {
            var u = app.project.underlay;
            if (!u) return;
            u.opacity = Number(this.value);
            View.render();
        });
        $('ulOpacity').addEventListener('change', function () {
            if (app.project.underlay) app.afterEdit('прозрачность подложки');
        });
        $('ulVisible').addEventListener('change', function () {
            var u = app.project.underlay;
            if (!u) return;
            u.visible = this.checked;
            app.afterEdit('подложка');
        });
        $('ulRemove').addEventListener('click', function () {
            if (!app.project.underlay) return;
            app.project.underlay = null;
            app.afterEdit('удаление подложки');
        });

        $('dxfBtn').addEventListener('click', function () {
            if (app.mode !== 'apt') {
                app.status('Чертёж (DXF или PDF) кладётся под план системы АПТ.', 'warn');
                return;
            }
            $('dxfInput').click();
        });
        $('dxfInput').addEventListener('change', function () {
            loadDrawing(this.files[0]);
            this.value = '';
        });
        $('dxfVisible').addEventListener('change', function () {
            var d = app.project.dxf;
            if (!d) return;
            d.visible = this.checked;
            app.afterEdit('чертёж DXF');
        });
        $('dxfRemove').addEventListener('click', function () {
            if (!app.project.dxf) return;
            app.project.dxf = null;
            app.afterEdit('удаление чертежа');
        });

        $('backToRiser').addEventListener('click', function () {
            if (app.plan) app.activate(app.plan.sys);
        });
        $('fitBtn').addEventListener('click', View.fit);
        $('pngBtn').addEventListener('click', function () { View.savePng(app.project.name); });

        // Снимок экрана плана из Revit вставляется прямо Ctrl+V.
        document.addEventListener('paste', function (e) {
            if (isField(document.activeElement) || app.mode !== 'apt') return;
            var items = e.clipboardData && e.clipboardData.items;
            if (!items) return;

            for (var i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image/') === 0) {
                    e.preventDefault();
                    loadUnderlay(items[i].getAsFile());
                    return;
                }
            }
        });

        var restored = Storage.restore();
        app.load(restored || Storage.newBook());
        Tools.set('select');

        /*
            Библиотека объектов: книга, которая сейчас открыта, становится
            рабочей копией объекта. Если библиотека не завелась (приватное окно,
            запрет IndexedDB), программа работает как раньше — на одной книге.
        */
        LibraryUI.init();
        Library.boot(app.book, !!restored).then(function (res) {
            if (res.opened) app.load(res.book);
            LibraryUI.chip();
        }, function () {
            LibraryUI.unavailable();
        });

        var lost = restored && restored.systems.some(function (s) {
            return s.project && s.project.underlay && !s.project.underlay.src;
        });
        if (lost) {
            app.status('Подложка не поместилась в память браузера — откройте файл проекта или загрузите картинку заново.', 'warn');
        }
    }

    app.init = init;
    return app;
})();

document.addEventListener('DOMContentLoaded', App.init);
