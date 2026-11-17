/*
    Вкладка «Гидравлика» → «Данные записки»: всё, что в записку ИОС2 нельзя получить из
    расчёта, — источник по ТУ, пожарные расходы и напор, категории насосных, место ИТП и
    схема ГВС. Поля попадают в текст записки; пустое поле остаётся там жёлтой пометкой.
    Ниже показано, что подставляется автоматически, и чего ещё не хватает.
*/

var UiHydNote = (function () {
    'use strict';

    var esc = Format.html;
    var num = Format.num;
    var body, state, reg;

    function init(b, s, r) { body = b; state = s; reg = r; }

    function hyd() { return App.project.hyd; }

    function show(res) {
        reg.length = 0;
        var d = hyd();
        if (!d.note) d.note = HydModel.defaultNote();
        var n = d.note;
        var h = [];
        var inp = UiHyd.inp;

        h.push('<div class="card"><div class="ctitle"><b>Данные для записки ИОС2</b><span class="no-print">'
            + '<button type="button" class="small" data-n="word">Записка ИОС2 (Word)</button></span></div>'
            + '<p class="hint">Здесь — то, что программа не может посчитать. Заполненное идёт в текст записки; незаполненное остаётся в ней жёлтой пометкой в квадратных скобках. '
            + 'Расчёты (расходы, напоры, счётчики, годовой баланс) выносятся в приложения.</p>'
            + '<div id="hnStatus"></div></div>');

        h.push('<div class="card no-print"><h2>Водоснабжение и ввод</h2><div class="form">'
            + inp('Откуда запитан ввод (по ТУ)', n, 'supplyFrom', { type: 'text', ph: 'кольцевого водопровода (согласно ТУ)', after: after })
            + inp('Наружное пожаротушение, л/с', n, 'fireExt', { min: 0, after: after })
            + inp('Есть противопожарный водопровод (ВПВ)', n, 'hasFire', { type: 'chk', struct: true, after: after })
            + (n.hasFire
                ? inp('Напор в точке ввода при пожаре, м', n, 'fireHead', { min: 0, after: after })
                + inp('Подключение насосов пожаротушения', n, 'fireConn', { type: 'text', ph: 'непосредственно от ввода в обвод водомерного узла через электрофицированные задвижки Ду125 Ру16', after: after })
                : '')
            + inp('Есть независимая система полива территории (по ТЗ)', n, 'irrigation', { type: 'chk', after: after })
            + '</div></div>');

        h.push('<div class="card no-print"><h2>Насосные установки</h2><div class="form">'
            + inp('Категория хоз.-питьевых насосных (по обеспеченности подачи воды)', n, 'catHp', { type: 'select', options: [['', '— не задана —'], ['I', 'I'], ['II', 'II'], ['III', 'III']], after: after })
            + (n.hasFire ? inp('Категория насосных пожаротушения', n, 'catFire', { type: 'select', options: [['', '— не задана —'], ['I', 'I'], ['II', 'II'], ['III', 'III']], after: after }) : '')
            + '</div></div>');

        h.push('<div class="card no-print"><h2>Горячее водоснабжение</h2><div class="form">'
            + inp('Схема ГВС', n, 'hotScheme', { type: 'select', options: [['', '— не задана —'], ['закрытая', 'закрытая (через теплообменники ИТП)'], ['открытая', 'открытая']], after: after })
            + inp('Где ИТП', n, 'itpPlace', { type: 'text', ph: 'в подвале в секции С2', after: after })
            + '</div></div>');

        h.push('<div class="card no-print"><h2>Годовой баланс</h2><div class="form">'
            + inp('Число суток в году для годового объёма', n, 'yearDays', { min: 1, max: 366, after: after })
            + '</div></div>');

        h.push('<div class="card" id="hnAuto"></div>');
        body.innerHTML = h.join('');
        refresh(res);
    }

    function after() { /* запись уже сделана общим обработчиком; статус обновит UiHyd.changed → refresh */ }

    /*
        Проверки перед выпуском: то, что в расчёте или подборе ещё не доведено и попадёт в записку
        недоделанным. level: bad — противоречит условиям подбора, warn — не заполнено или спорно.
    */
    function checks(res) {
        var d = hyd();
        var out = [];
        var add = function (level, text) { out.push({ level: level, text: text }); };

        HydPumps.rows(res, d).forEach(function (r) {
            var name = r.sys.name;
            if (!r.sel || !r.sel.name) { add('warn', 'Насосная «' + name + '» не подобрана по каталогу (вкладка «Насосы»)'); return; }
            if (r.check.ok === false) add('bad', 'Насосная «' + name + '»: ' + r.check.text);
            else if (r.check.ok === null) add('warn', 'Насосная «' + name + '»: не заданы Qф и Hф');
            if (r.check.qWarn) add('warn', 'Насосная «' + name + '»: ' + r.check.qWarn);
            if (r.check.drift) add('warn', 'Насосная «' + name + '»: ' + r.check.drift);
        });

        var meters = HydReport.meterRows(res, d);
        if (!meters.some(function (m) { return m.node.role === 'main'; })) add('warn', 'На вводе нет водомерного узла — поставьте «Счётчик» на ввод');
        meters.forEach(function (m) {
            if (!m.c.suitable) add('bad', 'Счётчик «' + m.place + '»: ' + m.c.status);
        });

        var fast = res.net.segs.filter(function (s) { return s.res && s.res.size && s.res.size.ok === false; }).length;
        if (fast) add('warn', 'Скорость выше допустимой на участках: ' + fast + ' (вкладка «Участки»)');

        res.warnings.slice(0, 8).forEach(function (w) { add('warn', w); });
        if (res.warnings.length > 8) add('warn', '… и ещё замечаний расчёта: ' + (res.warnings.length - 8));

        return out;
    }

    function checksBlock(res) {
        var list = checks(res);
        if (!list.length) return '<div class="verdict ok"><b>Проверки перед выпуском пройдены:</b> насосы подобраны, счётчики подходят, замечаний расчёта нет.</div>';
        return '<div class="verdict unknown"><b>Проверки перед выпуском (' + list.length + '):</b><ul style="margin:6px 0 0;padding-left:18px">'
            + list.map(function (x) { return '<li class="' + (x.level === 'bad' ? 'st-bad' : '') + '">' + esc(x.text) + '</li>'; }).join('') + '</ul></div>';
    }

    /* Что подставляется автоматически и чего не хватает. */
    function refresh(res) {
        res = res || UiHyd.result;
        var st = document.getElementById('hnStatus');
        var auto = document.getElementById('hnAuto');
        if (!st || !auto) return;

        if (!res || !res.input) {
            st.innerHTML = '<p class="hint">Записка строится по расчёту гидравлики: на схеме нужен ввод и стояки.</p>';
            auto.innerHTML = '';
            return;
        }

        var out;
        try { out = HydNote.build(App.project, res, hyd()); } catch (e) { st.innerHTML = '<div class="verdict fail">' + esc(e.message) + '</div>'; return; }

        var n = hyd().note;
        var c0 = out.context;
        var miss = [];
        if (!n.supplyFrom) miss.push('Откуда запитан ввод');
        if (!(n.fireExt > 0)) miss.push('Наружное пожаротушение');
        if (n.hasFire && !(n.fireHead > 0)) miss.push('Напор при пожаре');
        if (n.hasFire && !n.fireConn) miss.push('Подключение насосов пожаротушения');
        if (c0.zones.length && !n.catHp) miss.push('Категория хоз.-питьевых насосных');
        if (n.hasFire && !n.catFire) miss.push('Категория насосных пожаротушения');
        if (c0.hot && !n.hotScheme) miss.push('Схема ГВС');
        if (c0.itp.length && !n.itpPlace) miss.push('Где ИТП');

        st.innerHTML = miss.length
            ? '<div class="verdict unknown"><b>Не заполнено (' + miss.length + '):</b> ' + miss.map(esc).join('; ') + '.'
              + '<br><span class="note">Всего жёлтых пометок в тексте записки: ' + out.marks + '.</span></div>'
            : '<div class="verdict ok"><b>Данные заполнены.</b>' + (out.marks ? ' Жёлтых пометок в тексте: ' + out.marks + ' (' + esc(out.list.join('; ')) + ').' : ' Пометок в тексте не осталось.') + '</div>';

        var c = out.context;
        var rows = [];
        var r = c.root;
        rows.push(['Вводы', c.inputs.length + ' × ' + r.od + '×' + String(r.wall).replace('.', ',') + ', ' + HydData.material(r.material).name + '; Hгар ' + num(c.hgar, 1) + ' м, отметка ' + num(r.elev, 3)]);
        rows.push(['Расход на вводе', num(res.input.q, 3) + ' л/с (' + num(res.input.q * 3.6, 2) + ' м³/ч), людей ' + res.people]);
        c.zones.forEach(function (z) {
            rows.push(['Зона ' + z.no + ' (' + z.markC + ')', (z.from ? z.from + '–' + z.to + ' этаж, ' : '') + (z.top !== null ? 'отм. ' + num(z.top, 3) + ', ' : '')
                + 'Qтр ' + num(z.sys.pump.q, 3) + ' л/с, Hтр ' + num(z.sys.pump.hp, 1) + ' м']);
        });
        rows.push(['ИТП', c.itp.length ? c.itp.map(function (x) { return x.name; }).join(', ') : '— нет']);
        rows.push(['Встроенные помещения', c.builtin.length ? c.builtin.map(function (x) { return x.name; }).join(', ') : '— нет']);
        rows.push(['Насосы по каталогу', HydPumps.rows(res, hyd()).filter(function (x) { return x.sel; }).length + ' из ' + HydPumps.rows(res, hyd()).length + ' подобрано (вкладка «Насосы»)']);

        auto.innerHTML = checksBlock(res) + '<h2>Подставляется автоматически</h2><div class="scroll"><table class="grid"><tbody>'
            + rows.map(function (x) { return '<tr><td class="l">' + esc(x[0]) + '</td><td class="l">' + esc(x[1]) + '</td></tr>'; }).join('')
            + '</tbody></table></div>';
    }

    function onClick(e) {
        var b = e.target.closest('[data-n]');
        if (!b) return false;
        if (b.getAttribute('data-n') === 'word') {
            var t = document.getElementById('hydHist');
            try {
                var res = UiHyd.result;
                var out = HydNote.save(App.project, res, hyd());
                if (t) t.textContent = 'Записка выгружена; пометок в тексте: ' + out.marks;
            } catch (error) {
                if (t) t.textContent = 'Записка не выгружена: ' + error.message;
            }
        }
        return true;
    }

    return { init: init, show: show, refresh: refresh, onClick: onClick };
})();
