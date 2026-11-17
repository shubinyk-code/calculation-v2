'use strict';

/*
    Окно «Насосное оборудование»: таблица 4 записки во всю ширину экрана,
    с масштабом и с управлением каталожными листами.

    В узкой форме слева таблица из восьми столбцов не помещается: марка
    обрезается до «CO 1 MVI». Поэтому таблица живёт в отдельном окне, где:

        масштаб            кнопки − 100 % +, Ctrl + колесо, Ctrl + = / − / 0;
        загрузить листы    новые листы раскладываются по системам; если у
                           системы уже был лист той же роли, он заменяется,
                           и окно показывает «было → стало»;
        заменить лист      у конкретной строки — без угадывания системы;
        убрать             строку целиком;
        очистить листы     все строки, заполненные из листов (ручные остаются).

    Правки полей идут той же дорогой, что и в форме записки: TchUI.apply и
    App.afterEdit, поэтому работают отмена и автосохранение.
*/

var PumpWindow = (function () {

    var ZOOM_KEY = 'aupt-web:pumpZoom';
    var ZOOMS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2];

    var open = false;
    var zoom = 1;
    var target = null;          // { id, role } — строка, у которой меняют лист
    var changes = [];           // итог последней загрузки: что заменилось

    function $(id) { return document.getElementById(id); }
    function esc(t) { return Fmt.html(t); }

    function valueText(v) {
        if (v === null || v === undefined || v === '') return '';
        return typeof v === 'number' ? Fmt.trim(v, 3) : String(v);
    }

    function rowOf(list, id, role) {
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id && (list[i].role || 'main') === role) return list[i];
        }
        return null;
    }

    function today() {
        var d = new Date();
        return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear();
    }

    /* --- масштаб --------------------------------------------------------------- */

    function loadZoom() {
        try {
            var z = Number(localStorage.getItem(ZOOM_KEY));
            if (z >= ZOOMS[0] && z <= ZOOMS[ZOOMS.length - 1]) zoom = z;
        } catch (e) {
            // Хранилище недоступно — масштаб просто не запомнится.
        }
    }

    function setZoom(z) {
        zoom = Math.max(ZOOMS[0], Math.min(ZOOMS[ZOOMS.length - 1], z));
        try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch (e) { /* не запомнится */ }

        var box = document.querySelector('#pumpRoot .pump-zoom');
        if (box) box.style.zoom = zoom;
        var label = document.querySelector('#pumpRoot [data-action="pw-zoom-reset"]');
        if (label) label.textContent = Math.round(zoom * 100) + ' %';
    }

    function step(dir) {
        var i = 0;
        while (i < ZOOMS.length - 1 && ZOOMS[i] < zoom - 1e-6) i++;
        if (dir > 0) setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS[i] > zoom + 1e-6 ? i : i + 1)]);
        else setZoom(ZOOMS[Math.max(0, i - 1)]);
    }

    /* --- листы ------------------------------------------------------------------ */

    function readAll(files) {
        return Promise.all(Array.prototype.slice.call(files).map(function (file) {
            return Pumps.read(file).then(function (sheet) {
                return { file: file, sheet: sheet };
            }).catch(function (e) {
                return { file: file, error: e && e.message ? e.message : String(e) };
            });
        }));
    }

    /** Положить лист в строку системы. Возвращает запись для отчёта «было → стало». */
    function place(book, sheet, id, role) {
        var row = Pumps.toRow(sheet, id);
        if (role) row.role = role;
        row.loadedAt = today();

        var old = rowOf(book.text.pumps, id, row.role);
        book.text.pumps = book.text.pumps.filter(function (p) {
            return !(p.id === id && (p.role || 'main') === row.role);
        }).concat([row]);

        var sys = Systems.find(book, id);
        var station = (book.stations || []).filter(function (s) { return s.id === id; })[0];
        // Номер приложения у листа свой — он же стоит в перечне приложений записки.
        var no = Appendix.of(book, (row.role === 'jockey' ? 'jockey:' : 'pump:') + id);
        var where = (sys ? sys.code : station ? station.name : '?') + (row.role === 'jockey' ? ', жокей' : '')
            + (no ? ' (приложение ' + no + ')' : '');

        if (old && old.name && old.name !== row.name) {
            return { kind: 'replaced', text: where + ': ' + old.name + ' → ' + row.name };
        }
        if (old && old.name) {
            return { kind: 'updated', text: where + ': ' + row.name + ' — лист обновлён' };
        }
        return { kind: 'added', text: where + ': ' + row.name };
    }

    /** Загрузить листы: с разбором по системам или в конкретную строку. */
    function load(files, into) {
        if (!files || !files.length) return;

        App.status('Читаю каталожные листы: ' + files.length + '…');

        readAll(files).then(function (results) {
            var book = App.book;
            var report = [];
            var failed = [];

            results.forEach(function (res, i) {
                if (res.error || !res.sheet.ok) {
                    failed.push(res.file.name + (res.error ? ': ' + res.error : ': не нашлись марка и напор — возможно, лист вставлен картинкой'));
                    return;
                }

                if (into && i === 0) {
                    report.push(place(book, res.sheet, into.id, into.role));
                    return;
                }

                var id = Pumps.match(res.sheet, book) || (book.systems[0] && book.systems[0].id);
                if (id) report.push(place(book, res.sheet, id));
            });

            changes = report.concat(failed.map(function (f) { return { kind: 'failed', text: f }; }));

            if (report.length) App.afterEdit(into ? 'замена каталожного листа' : 'каталожные листы');
            else if (open) render();

            var replaced = report.filter(function (r) { return r.kind === 'replaced'; }).length;
            App.status(report.length
                ? 'Листов разобрано: ' + report.length + (replaced ? ', заменено установок: ' + replaced : '')
                    + (failed.length ? '. Не разобрано: ' + failed.length : '') + '. Подробности — в окне насосов.'
                : 'Ни один лист не разобран: ' + failed.join('; '), report.length ? 'done' : 'warn');

            if (!open) show();
        });
    }

    function remove(id, role) {
        var book = App.book;
        book.text.pumps = book.text.pumps.filter(function (p) {
            return !(p.id === id && (p.role || 'main') === role);
        });
        App.afterEdit('строка насоса');
    }

    function clearSheets() {
        var book = App.book;
        var fromSheets = book.text.pumps.filter(function (p) { return p.sheet; });
        if (!fromSheets.length) {
            App.status('Строк из каталожных листов нет.', 'warn');
            return;
        }
        if (!window.confirm('Убрать ' + fromSheets.length + ' строк, заполненных из каталожных листов? '
            + 'Строки, вписанные руками, останутся. Отменить можно кнопкой «Отменить».')) return;

        book.text.pumps = book.text.pumps.filter(function (p) { return !p.sheet; });
        changes = [];
        App.afterEdit('очистка каталожных листов');
        App.status('Каталожные листы убраны — загрузите новые.', 'done');
    }

    /* --- таблица ---------------------------------------------------------------- */

    function input(key, value, cls, placeholder) {
        return '<input class="cell ' + (cls || '') + '" data-key="' + key + '" value="' + esc(valueText(value)) + '"'
            + (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + '>';
    }

    function sheetCell(row, need) {
        if (!row || !row.sheet) return '<td class="dim">вписано руками</td>';

        var parts = ['<div class="sheet-file" title="' + esc(row.sheet) + '">' + esc(row.sheet) + '</div>'];
        if (row.loadedAt) parts.push('<div class="dim">загружен ' + esc(row.loadedAt) + '</div>');
        if (row.dutyH > 0) parts.push('<div class="dim">в листе задано ' + Fmt.num(row.dutyQ || 0, 2) + ' л/с, ' + Fmt.num(row.dutyH, 2) + ' м</div>');

        var reference = row.role === 'jockey' ? (need ? need.after : 0) : (need ? need.H : 0);
        if (row.role !== 'jockey' && row.dutyH > 0 && reference > 0 && Math.abs(row.dutyH - reference) > Math.max(1, reference * 0.05)) {
            parts.push('<div class="bad">расходится с расчётом на ' + Fmt.num(Math.abs(row.dutyH - reference), 2) + ' м — проверьте подбор</div>');
        }
        return '<td class="sheet-cell">' + parts.join('') + '</td>';
    }

    function actions(id, role, hasRow) {
        return '<td class="row-actions"><button data-action="pw-replace:' + id + ':' + role + '">'
            + (hasRow ? 'Заменить лист…' : 'Загрузить лист…') + '</button>'
            + (hasRow ? '<button class="danger" data-action="pw-del:' + id + ':' + role + '">Убрать</button>' : '') + '</td>';
    }

    function systemSelect(row, items) {
        return '<select data-key="tp:' + row.id + ':' + row.role + ':system">'
            + items.map(function (item) {
                return '<option value="' + esc(item.sys.id) + '"' + (item.sys.id === row.id ? ' selected' : '') + '>' + esc(item.sys.code) + '</option>';
            }).join('')
            + (items.some(function (item) { return item.sys.id === row.id; }) ? '' : '<option value="' + esc(row.id) + '" selected>нет системы</option>')
            + '</select>';
    }

    /** Номер приложения строки: его раздаёт общий счёт книги. */
    function noCell(no) {
        return '<td class="num">' + (no ? '<b>' + esc(no) + '</b>' : '<span class="dim">—</span>') + '</td>';
    }

    function mainRow(item, row, nums) {
        var need = Tch.pumpNeed(item);
        var id = item.sys.id;
        var key = 'tp:' + id + ':main:';
        row = row || {};

        return '<tr class="main-row">'
            + '<td><b>' + esc(item.sys.code) + '</b><div class="dim">' + esc(item.sys.title || '') + '</div>'
            + '<label class="check inline" title="У насосной есть жокей-насос — ему нужен свой каталожный лист и своё приложение">'
            + '<input type="checkbox" data-key="pj:' + id + '"' + (Appendix.jockeyOn(item) ? ' checked' : '') + '> жокей</label></td>'
            + noCell(nums['pump:' + id])
            + '<td>основная</td>'
            + '<td>' + input(key + 'name', row.name, 'name', 'марка установки') + '</td>'
            + '<td>' + input(key + 'power', row.power, 'short') + '</td>'
            + '<td>' + input(key + 'count', row.count, 'count', '1 раб., 1 рез.') + '</td>'
            + '<td class="num calc">' + Fmt.num(need.Q, 2) + '</td>'
            + '<td class="num calc">' + Fmt.num(need.H, 2) + '</td>'
            + '<td>' + input(key + 'Qf', row.Qf, 'short') + '</td>'
            + '<td>' + input(key + 'Hf', row.Hf, 'short') + '</td>'
            + sheetCell(row.name || row.sheet ? row : null, need)
            + actions(id, 'main', !!(row.name || row.sheet))
            + '</tr>';
    }

    function extraRow(row, items, need, nums) {
        var key = 'tp:' + row.id + ':' + row.role + ':';
        return '<tr class="extra-row">'
            + '<td>' + systemSelect(row, items) + '</td>'
            + noCell((nums || {})[(row.role === 'jockey' ? 'jockey:' : 'pump:') + row.id])
            + '<td>жокей</td>'
            + '<td>' + input(key + 'name', row.name, 'name') + '</td>'
            + '<td>' + input(key + 'power', row.power, 'short') + '</td>'
            + '<td>' + input(key + 'count', row.count, 'count', '1 раб.') + '</td>'
            + '<td>' + input(key + 'dutyQ', row.dutyQ, 'short') + '</td>'
            + '<td>' + input(key + 'dutyH', row.dutyH, 'short') + '</td>'
            + '<td>' + input(key + 'Qf', row.Qf, 'short') + '</td>'
            + '<td>' + input(key + 'Hf', row.Hf, 'short') + '</td>'
            + sheetCell(row.name || row.sheet ? row : null, need)
            + actions(row.id, row.role, !!(row.name || row.sheet))
            + '</tr>';
    }

    function changesBlock() {
        if (!changes.length) return '';
        var names = { replaced: 'заменено', updated: 'обновлено', added: 'добавлено', failed: 'не разобрано' };
        return '<div class="pump-changes"><b>Последняя загрузка листов:</b><ul>'
            + changes.map(function (c) {
                return '<li class="' + c.kind + '"><span>' + names[c.kind] + '</span> ' + esc(c.text) + '</li>';
            }).join('') + '</ul></div>';
    }

    function html() {
        var book = App.book;
        var t = book.text;
        var info = Tch.systems(book);
        var owners = Tch.owners(info);
        var needs = {};
        owners.forEach(function (item) { needs[item.sys.id] = Tch.pumpNeed(item); });

        var nums = Appendix.numbers(book, info);
        var body = '';

        owners.forEach(function (item) {
            body += mainRow(item, rowOf(t.pumps, item.sys.id, 'main'), nums);

            var hasJockey = false;
            t.pumps.forEach(function (row) {
                if (row.id === item.sys.id && (row.role || 'main') !== 'main') {
                    hasJockey = true;
                    body += extraRow(row, owners, needs[row.id], nums);
                }
            });

            // Жокей включён, а листа ещё нет — строка всё равно нужна: в неё
            // грузится каталожный лист, и у неё свой номер приложения.
            if (!hasJockey && Appendix.jockeyOn(item) && nums['jockey:' + item.sys.id]) {
                body += extraRow({ id: item.sys.id, role: 'jockey' }, owners, needs[item.sys.id], nums);
            }
        });

        // Строки, чья система удалена из книги, — чтобы их можно было переназначить.
        t.pumps.forEach(function (row) {
            if (needs[row.id]) return;
            body += extraRow({ id: row.id, role: row.role || 'main', name: row.name, power: row.power, count: row.count,
                dutyQ: row.dutyQ, dutyH: row.dutyH, Qf: row.Qf, Hf: row.Hf, sheet: row.sheet, loadedAt: row.loadedAt }, owners, null, nums);
        });

        return '<div class="modal pump-modal"><div class="sheet pump-sheet" role="dialog" aria-label="Насосное оборудование">'
            + '<div class="pump-bar">'
            + '<h2>Насосное оборудование — таблица 4</h2>'
            + '<div class="spacer"></div>'
            + '<button data-action="pw-request" class="primary">Отправить на подбор…</button>'
            + '<button data-action="pw-load">Загрузить листы .pdf…</button>'
            + '<button data-action="pw-clear" class="danger">Очистить листы</button>'
            + '<span class="zoom-group" title="Масштаб: Ctrl + колесо, Ctrl + = / − / 0">'
            + '<button data-action="pw-zoom-out">−</button>'
            + '<button data-action="pw-zoom-reset">' + Math.round(zoom * 100) + ' %</button>'
            + '<button data-action="pw-zoom-in">+</button></span>'
            + '<button data-action="pw-close" class="primary">Готово</button>'
            + '</div>'
            + '<p class="hint">Qтр и Hтр основных установок — из расчёта систем, у жокей-насосов — из их листов. Если насосы поменялись, '
            + 'загрузите новые листы: у системы заменится лист той же роли, а ниже будет видно, что на что поменялось. '
            + 'Заменить лист у одной строки — кнопка в строке; убрать все листы разом — «Очистить листы».</p>'
            + changesBlock()
            + '<div class="pump-scroll"><div class="pump-zoom" style="zoom:' + zoom + '">'
            + '<table class="grid pump-table"><thead><tr>'
            + '<th>Система</th><th>Прил.</th><th>Роль</th><th>Марка установки</th><th>Р, кВт</th><th>Кол-во (раб., рез.)</th>'
            + '<th>Qтр, л/с</th><th>Hтр, м</th><th>Qф, л/с</th><th>Hф, м</th><th>Каталожный лист</th><th></th>'
            + '</tr></thead><tbody>' + body + '</tbody></table>'
            + '</div></div>'
            + '</div></div>';
    }

    function render() {
        var root = $('pumpRoot');
        if (!open) {
            root.innerHTML = '';
            return;
        }

        var active = document.activeElement;
        var key = active && root.contains(active) && active.dataset ? active.dataset.key : null;
        var scroll = root.querySelector('.pump-scroll');
        var top = scroll ? scroll.scrollTop : 0;
        var left = scroll ? scroll.scrollLeft : 0;

        root.innerHTML = html();

        scroll = root.querySelector('.pump-scroll');
        scroll.scrollTop = top;
        scroll.scrollLeft = left;

        if (key) {
            var el = root.querySelector('[data-key="' + key.replace(/"/g, '\\"') + '"]');
            if (el) el.focus({ preventScroll: true });
        }
    }

    function show() {
        open = true;
        render();
    }

    function close() {
        open = false;
        render();
    }

    /* --- события ---------------------------------------------------------------- */

    function onChange(e) {
        var el = e.target;
        var key = el.dataset ? el.dataset.key : null;
        if (!key) return;
        var value = el.value;

        // Галочка «жокей» у насосной: с ней появляется своё приложение и лист.
        if (/^pj:/.test(key)) {
            var id = key.slice(3);
            var on = el.checked;
            setTimeout(function () {
                var book = App.book;
                var holder = Systems.find(book, id) || (book.stations || []).filter(function (s) { return s.id === id; })[0];
                if (!holder) return;
                holder.jockey = on;
                App.afterEdit(on ? 'жокей-насос включён' : 'жокей-насос отключён');
            }, 0);
            return;
        }

        setTimeout(function () {
            TchUI.apply(key, value);
            App.afterEdit('насосное оборудование');
        }, 0);
    }

    function onClick(e) {
        var modal = e.target.closest('.pump-sheet');
        if (!modal && e.target.closest('.pump-modal')) {
            close();
            return;
        }

        var b = e.target.closest('[data-action]');
        if (!b) return;
        var parts = b.dataset.action.split(':');

        switch (parts[0]) {
            case 'pw-close': close(); break;
            case 'pw-load': target = null; $('pumpSheetsInput').click(); break;
            case 'pw-clear': clearSheets(); break;
            case 'pw-zoom-in': step(1); break;
            case 'pw-zoom-out': step(-1); break;
            case 'pw-zoom-reset': setZoom(1); break;
            case 'pw-replace':
                target = { id: parts[1], role: parts[2] };
                $('pumpReplaceInput').click();
                break;
            case 'pw-del': remove(parts[1], parts[2]); break;
            case 'pw-request': RequestUI.open(); break;
        }
    }

    function onWheel(e) {
        if (!open || !(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        step(e.deltaY < 0 ? 1 : -1);
    }

    function onKey(e) {
        if (!open) return;
        if (e.key === 'Escape') {
            close();
            return;
        }
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.key === '=' || e.key === '+') { e.preventDefault(); step(1); }
        else if (e.key === '-') { e.preventDefault(); step(-1); }
        else if (e.key === '0') { e.preventDefault(); setZoom(1); }
    }

    function init() {
        loadZoom();

        var root = document.createElement('div');
        root.id = 'pumpRoot';
        document.body.appendChild(root);

        ['pumpSheetsInput', 'pumpReplaceInput'].forEach(function (id) {
            var inputEl = document.createElement('input');
            inputEl.type = 'file';
            inputEl.id = id;
            inputEl.accept = '.pdf';
            inputEl.hidden = true;
            if (id === 'pumpSheetsInput') inputEl.multiple = true;
            document.body.appendChild(inputEl);
        });

        root.addEventListener('change', onChange);
        root.addEventListener('click', onClick);
        root.addEventListener('wheel', onWheel, { passive: false });
        document.addEventListener('keydown', onKey, true);

        $('pumpSheetsInput').addEventListener('change', function () {
            load(this.files, null);
            this.value = '';
        });
        $('pumpReplaceInput').addEventListener('change', function () {
            load(this.files, target);
            target = null;
            this.value = '';
        });
    }

    return {
        init: init,
        open: show,
        close: close,
        refresh: function () { if (open) render(); },
        isOpen: function () { return open; },
        load: load,
        pick: function () { target = null; $('pumpSheetsInput').click(); },
        place: place
    };
})();
