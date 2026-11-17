/*
    Вкладка «Гидравлика» → «Насосы»: подбор насосных установок по каталогу.

    Для каждой установки схемы показаны требуемые Qтр и Hтр; из каталожного листа
    (PDF Wilo) берутся марка, мощность, количество и фактическая рабочая точка. Как в
    «Спринклерах»:

        загрузить листы    общая кнопка: листы раскладываются по установкам сами (по
                           зоне в «Назначении» и близости напора); если у установки уже
                           был лист, он заменяется, а ниже видно «было → стало»;
        лист в строку      кнопка в строке установки — без угадывания, лист ляжет именно сюда;
        сбросить           строку целиком; «Очистить листы» — все строки из листов (ручные остаются).

    Любое поле правится руками. Условие подбора: Qф ≥ Qтр и Hф ≥ Hтр.
*/

var UiHydPumps = (function () {
    'use strict';

    var esc = Format.html;
    var num = Format.num;
    var body, state, reg;

    function init(b, s, r) { body = b; state = s; reg = r; }

    function hyd() { return App.project.hyd; }

    /* Замечания к подбору, который формально проходит: расход с запасом больше 10 %, заданная точка листа не та. */
    function warnings(c) {
        var out = [];
        if (c.qWarn) out.push(c.qWarn);
        if (c.drift) out.push(c.drift);
        return out;
    }

    function mark(c) {
        var w = warnings(c).map(function (t) { return '<div class="st-warn pm-warn">⚠ ' + esc(t) + '</div>'; }).join('');
        if (c.ok === true) return (w ? '<span class="st-warn"><b>проходит, но проверьте</b></span>' : '<span class="st-ok">проходит</span>') + w;
        if (c.ok === false) return '<span class="st-bad">не проходит</span><br><span class="note">' + esc(c.text) + '</span>' + w;
        if (c.qOk === null && c.hOk === null) return '<span class="note">не подобран</span>';
        return '<span class="note">нужны Qф и Hф</span>' + w;
    }

    function sheetCell(r) {
        var s = r.sel;
        if (!s) return '<span class="note">—</span>';
        if (!s.sheet) return '<span class="note">введено вручную</span>';

        var parts = ['<div title="' + esc(s.sheet) + '">' + esc(s.sheet) + '</div>'];
        if (!s.data) parts.push('<div class="note" title="Без файла в пакете листов не будет штампа «Приложение N»">файл не сохранён — загрузите лист заново</div>');
        if (s.loadedAt) parts.push('<div class="note">загружен ' + esc(s.loadedAt) + '</div>');
        if (s.dutyH > 0) parts.push('<div class="note">в листе задано ' + num(s.dutyQ || 0, 2) + ' л/с, ' + num(s.dutyH, 1) + ' м</div>');
        return parts.join('');
    }

    function changesBlock() {
        var list = state.pumpChanges;
        if (!list || !list.length) return '';
        var names = { replaced: 'заменено', updated: 'обновлено', added: 'добавлено', failed: 'не разобрано', info: '' };
        return '<div class="verdict unknown no-print"><b>Последняя загрузка листов:</b><ul style="margin:6px 0 0;padding-left:18px">'
            + list.map(function (c) { return '<li><b>' + names[c.kind] + '</b> ' + esc(c.text) + '</li>'; }).join('') + '</ul></div>';
    }

    function show(res) {
        reg.length = 0;
        var d = hyd();
        var h = [];

        if (!res || !res.input) { body.innerHTML = '<div class="card"><p class="hint">Расчёта нет: на схеме нужен ввод и стояки.</p></div>'; return; }

        var list = HydPumps.rows(res, d);

        h.push('<div class="card"><div class="ctitle"><b>Подбор насосных установок по каталогу</b><span class="no-print">'
            + '<button type="button" class="small" data-p="load">Загрузить листы Wilo (PDF)…</button> '
            + '<button type="button" class="small" data-p="wipe">Очистить листы</button> '
            + '<button type="button" class="small" data-p="mail">Отправить на подбор…</button> '
            + '<button type="button" class="small" data-p="pack">Пакет приложений (расчёты + листы)</button> '
            + '<button type="button" class="small" data-p="sheetspdf">Каталожные листы (PDF)</button> '
            + '<button type="button" class="small" data-p="word">Таблица 3 в Word</button> '
            + '<button type="button" class="small" data-p="excel">В Excel (вся гидравлика)</button>'
            + '<input type="file" id="hpFiles" accept=".pdf,application/pdf" multiple style="display:none"></span></div>'
            + '<p class="hint">Qтр (л/с) и Hтр — из расчёта (Hтр = Hgeom + ΣHl,tot + Hпр − Hгар). '
            + '<b>Общая загрузка:</b> выберите сразу все листы — каждый ляжет на свою установку по зоне и близости напора; если у установки уже был лист, он заменится, и ниже будет видно, что на что поменялось. '
            + '<b>Лист в одну установку:</b> кнопка «Загрузить / Заменить лист» в её строке, без угадывания. '
            + 'Подбор годится, если Qф ≥ Qтр и Hф ≥ Hтр. Поля можно править руками. Жокей-насосы в таблицу не входят.</p>');

        h.push(changesBlock());

        if (!list.length) {
            h.push('<p class="hint">Насосных установок на схеме нет: поставьте «Насосная» на трубу (тогда у системы появится зона и Hтр).</p></div>');
            body.innerHTML = h.join('');
            return;
        }

        h.push('<div class="scroll"><table class="grid"><thead><tr><th class="left">Установка (зона)</th><th>Qтр, л/с</th><th>Hтр, м</th>'
            + '<th class="left">Наименование (марка)</th><th>Р2, кВт</th><th class="left">Кол-во</th><th>Qф, л/с</th><th>Hф, м</th>'
            + '<th class="left">Проверка</th><th class="left">Каталожный лист</th><th></th></tr></thead><tbody>');

        list.forEach(function (r) {
            var sys = r.sys;
            var ed = r.sel || HydPumps.blankSel();
            var after = function () { ed.source = 'manual'; d.pumpSel[sys.id] = ed; };
            var cell = function (key, type, w) { return UiHyd.inp('', ed, key, { type: type, bare: true, w: w, after: after }); };

            var warned = warnings(r.check).length > 0;
            h.push('<tr class="' + (r.check.ok === false ? 'fail' : (warned ? 'warnrow' : '')) + '"><td class="left"><b>' + esc(sys.name) + '</b></td>'
                + '<td>' + num(sys.pump.q, 3) + '</td><td><b>' + num(sys.pump.hp, 1) + '</b></td>'
                + '<td class="left">' + cell('name', 'text') + '</td>'
                + '<td>' + cell('power', 'num', '64px') + '</td>'
                + '<td class="left">' + UiHyd.inp('', ed, 'count', { type: 'text', bare: true, ph: HydPumps.countOf(sys.node, null), after: after }) + '</td>'
                + '<td' + (r.check.qWarn ? ' class="hl" title="' + esc(r.check.qWarn) + '"' : '') + '>' + cell('Qf', 'num', '72px')
                + (r.check.qDev !== null && Math.abs(r.check.qDev) > HydPumps.Q_TOL ? '<div class="pm-dev">' + (r.check.qDev > 0 ? '+' : '−') + Math.round(Math.abs(r.check.qDev) * 100) + ' %</div>' : '') + '</td>'
                + '<td>' + cell('Hf', 'num', '72px') + '</td>'
                + '<td class="left">' + mark(r.check) + '</td>'
                + '<td class="left">' + sheetCell(r) + '</td>'
                + '<td class="no-print"><button type="button" class="mini" data-p="into" data-arg="' + esc(sys.id) + '">'
                + (r.sel && r.sel.name ? 'Заменить лист…' : 'Загрузить лист…') + '</button>'
                + (r.sel ? ' <button type="button" class="mini" data-p="clear" data-arg="' + esc(sys.id) + '">сбросить</button>' : '') + '</td></tr>');
        });

        h.push('</tbody></table></div></div>');
        body.innerHTML = h.join('');
    }

    /* --- листы ------------------------------------------------------------------ */

    /* Прочитать листы по очереди; возвращает { sheets, errors }. */
    function readAll(list) {
        var sheets = [];
        var errors = [];

        return list.reduce(function (chain, file) {
            return chain.then(function () {
                return HydPumps.read(file).then(function (s) { sheets.push(s); }, function (err) {
                    errors.push(file.name + ': ' + (err && err.message ? err.message : err));
                });
            });
        }, Promise.resolve()).then(function () { return { sheets: sheets, errors: errors }; });
    }

    /*
        Загрузка. into — id установки: тогда первый лист кладётся именно в неё, без разбора
        по системам; иначе листы раскладываются по установкам сами.
    */
    function load(files, res, changed, into) {
        var list = Array.prototype.slice.call(files);
        if (!list.length) return;

        state.pumpChanges = [{ kind: 'info', text: 'Читаю листы: ' + list.length + '…' }];
        if (state.sub === 'pumps') show(res);

        readAll(list).then(function (got) {
            var report = [];
            var pumped = res.systems.filter(function (s) { return s.pump && s.pump.pumped; });
            var sheets = got.sheets;

            if (into) {
                var sys = pumped.filter(function (s) { return s.id === into; })[0];
                var sheet = sheets[0];
                if (sys && sheet && sheet.ok) report.push(HydPumps.place(hyd(), sys, sheet));
                else if (sheet) report.push({ kind: 'failed', text: sheet.file + ': не нашлись марка и напор — возможно, лист вставлен картинкой' });
                sheets.slice(1).forEach(function (s) { report.push({ kind: 'failed', text: s.file + ': лишний файл — в строку кладётся один лист' }); });
            } else {
                var out = HydPumps.assign(sheets, res.systems);
                Object.keys(out.assigned).forEach(function (id) {
                    var sys2 = pumped.filter(function (s) { return s.id === id; })[0];
                    if (sys2) report.push(HydPumps.place(hyd(), sys2, out.assigned[id]));
                });
                out.skipped.forEach(function (x) { report.push({ kind: 'failed', text: x.sheet.file + ': ' + x.why }); });
            }

            got.errors.forEach(function (e) { report.push({ kind: 'failed', text: e }); });
            state.pumpChanges = report.length ? report : [{ kind: 'failed', text: 'Листы не распознаны.' }];
            changed(false);
        });
    }

    function wipe(changed) {
        var d = hyd();
        var ids = Object.keys(d.pumpSel).filter(function (id) { return d.pumpSel[id].sheet; });
        if (!ids.length) { state.pumpChanges = [{ kind: 'failed', text: 'Строк из каталожных листов нет.' }]; changed(false); return; }
        if (!window.confirm('Убрать ' + ids.length + ' установок, заполненных из каталожных листов? Строки, вписанные руками, останутся. Отменить можно кнопкой «Отменить».')) return;
        ids.forEach(function (id) { delete d.pumpSel[id]; });
        state.pumpChanges = [{ kind: 'info', text: 'Каталожные листы убраны — загрузите новые.' }];
        changed(false);
    }

    /* --- события ---------------------------------------------------------------- */

    function pick(multiple, into) {
        var f = document.getElementById('hpFiles');
        if (!f) return;
        state.pumpInto = into || '';
        f.multiple = multiple;
        f.click();
    }

    function onChange(e, changed) {
        if (e.target.id !== 'hpFiles') return false;
        var into = state.pumpInto;
        state.pumpInto = '';
        load(e.target.files, UiHyd.result, changed, into);
        e.target.value = '';
        return true;
    }

    function onClick(e, changed) {
        var b = e.target.closest('[data-p]');
        if (!b) return false;
        var act = b.getAttribute('data-p');
        var arg = b.getAttribute('data-arg');
        var res = UiHyd.result;

        if (act === 'load') pick(true, '');
        else if (act === 'into') pick(false, arg);
        else if (act === 'wipe') wipe(changed);
        else if (act === 'clear') { delete hyd().pumpSel[arg]; changed(false); }
        else if (act === 'mail') UiHydRequest.open();
        else if (act === 'sheetspdf') { if (res) sheetsPdf(res, false); }
        else if (act === 'pack') { if (res) sheetsPdf(res, true); }
        else if (act === 'word') { if (res) HydReport.pumpsToWord(res, hyd()); }
        else if (act === 'excel') { if (res) HydReport.toExcel(res, hyd()); }
        return true;
    }

    function say(text, kind) {
        if (App.status) App.status(text, kind || 'done');
        var t = document.getElementById('hydHist');
        if (t) t.textContent = text;
    }

    /*
        Каталожные листы одним PDF со штампом «Приложение N» (номера — как в записке). С расчётами
        (print = true): следом открывается печать листов расчёта — «Сохранить как PDF» даёт второй файл.
    */
    function sheetsPdf(res, print) {
        var d = hyd();
        say('Собираю пакет…');

        HydPackage.sheetsPdf(App.project, res, d).then(function (got) {
            if (got.count) {
                PdfWrite.save(got.bytes, HydPackage.fileName(App.project, d, 'каталожные листы.pdf'));
                say('Каталожные листы: ' + got.count + ' шт. со штампом «Приложение N».' + (got.missing.length ? ' Нет файла у: ' + got.missing.join(', ') + ' — загрузите лист заново.' : ''));
            } else {
                say('Нет сохранённых файлов каталожных листов' + (got.missing.length ? ' (' + got.missing.join(', ') + ')' : '') + ': загрузите листы заново — программа сохранит их в проекте.', 'warn');
            }
            if (print) printCalc(res);
        }).catch(function (err) {
            say('Пакет не собрался: ' + (err && err.message ? err.message : err), 'warn');
        });
    }

    /* Приложения-расчёты листами на печать: страница альбомная, справа вверху «Приложение N». */
    function printCalc(res) {
        var pack = HydPackage.calcHtml(App.project, res, hyd());
        if (!pack.count) { say('Приложений-расчётов нет.', 'warn'); return; }

        var root = document.createElement('div');
        root.id = 'packPrint';
        root.innerHTML = pack.html;
        var page = document.createElement('style');
        page.textContent = '@page { size: A4 landscape; margin: 12mm; }';
        document.body.appendChild(root);
        document.head.appendChild(page);
        document.body.classList.add('pack-printing');

        var done = function () {
            window.removeEventListener('afterprint', done);
            document.body.classList.remove('pack-printing');
            if (root.parentNode) root.parentNode.removeChild(root);
            if (page.parentNode) page.parentNode.removeChild(page);
        };
        window.addEventListener('afterprint', done);
        say('Приложений-расчётов в печати: ' + pack.count + '. В окне печати выберите «Сохранить как PDF».');
        setTimeout(function () { window.print(); }, 50);
    }

    /* Лист прямо в установку, из инспектора схемы: временное поле выбора файла. */
    function pickInto(id) {
        var f = document.createElement('input');
        f.type = 'file';
        f.accept = '.pdf,application/pdf';
        f.addEventListener('change', function () { load(f.files, UiHyd.result, UiHyd.changed, id); });
        f.click();
    }

    return { init: init, show: show, onChange: onChange, onClick: onClick, load: load, pick: pick, pickInto: pickInto };
})();
