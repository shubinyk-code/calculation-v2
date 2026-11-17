/*
    Вкладка «Гидравлика» → «Задание ЭЛ и СС»: задание от ВК для электриков и слаботочников.

    Оборудование раздела ВК, которому нужны питание и/или диспетчеризация, собирается из расчёта само
    (насосные станции с мощностью из каталожного листа, водомерные узлы, квартирные счётчики, датчики
    давления). Помещения, примечания, мощность и протокол правятся у каждой строки; то, чего на схеме нет
    (воронки с обогревом, дренажные насосы, полотенцесушители, КНС, электроприводы арматуры), добавляется
    строкой. Выгрузка — бланк бюро в Excel: целиком, только для ЭЛ или только для СС.
*/

var UiHydElss = (function () {
    'use strict';

    var esc = Format.html;
    var body, state, reg;

    function init(b, s, r) { body = b; state = s; reg = r; }

    function hyd() { return App.project.hyd; }

    function ensureElss() {
        var d = hyd();
        if (!d.elss) d.elss = HydModel.defaultElss();
        return d.elss;
    }

    /* Правки автоматической строки пишутся в elss.auto[key] — только то, что изменили. */
    function autoField(it, key, type, w, extra) {
        var e = ensureElss();
        var proxy = {};
        proxy[key] = it[key] === null || it[key] === undefined ? (type === 'text' || type === 'select' ? '' : null) : it[key];
        return UiHyd.inp('', proxy, key, Object.assign({ type: type, bare: true, w: w, after: function (v) {
            var o = e.auto[it.key] || (e.auto[it.key] = { room: '', note: '', name: '', dispatch: '', protocol: '', kw: null, volt: null, skip: false });
            o[key] = v;
        } }, extra || {}));
    }

    function manualField(r, key, type, w, extra) {
        return UiHyd.inp('', r, key, Object.assign({ type: type, bare: true, w: w }, extra || {}));
    }

    function protocolOptions() {
        return HydElss.PROTOCOLS.map(function (p) { return [p, p]; });
    }

    /* Подстановка из каталога электроприводов: наименование, мощность, напряжение и описание. */
    function applyActuator(r) {
        if (!r.act || !r.act.size) return;
        var f = HydElss.actuator(r.act.size, r.act.time);
        if (!f) return;
        // время не выбрано — стандартное (в каталоге помечено «*»), иначе первое
        if (!f.a.variants.some(function (v) { return v.time === r.act.time; })) {
            r.act.time = (f.a.variants.filter(function (v) { return v.time.indexOf('*') >= 0; })[0] || f.a.variants[0]).time;
        }
        var f2 = HydElss.actuator(r.act.size, r.act.time);
        var volt = r.volt === 220 ? 220 : 380;

        r.volt = volt;
        r.kw = f2.v.kw;
        r.name = 'Электропривод ADL ' + f2.a.size;
        r.desc = HydElss.actuatorText(f2.a.size, f2.v.time, volt);
    }

    function actuatorPicker(r) {
        if (!r.act) r.act = { size: '', time: '' };
        var sizeOpts = [['', '— выбрать из каталога —']].concat(HydElss.ACTUATORS.map(function (a) { return [a.size, a.size + ' (' + a.torque + ' Н·м)']; }));
        var cur = HydElss.ACTUATORS.filter(function (a) { return a.size === r.act.size; })[0];
        var timeOpts = cur ? cur.variants.map(function (v) { return [v.time, v.time + ' с — ' + String(v.kw).replace('.', ',') + ' кВт']; }) : [['', '—']];
        var after = function () { applyActuator(r); };

        return '<div class="row" style="margin:4px 0">'
            + UiHyd.inp('Электропривод ADL SQ', r.act, 'size', { type: 'select', options: sizeOpts, struct: true, after: after })
            + UiHyd.inp('Время поворота на 90°', r.act, 'time', { type: 'select', options: timeOpts, struct: true, after: after })
            + UiHyd.inp('Питание, В', r, 'volt', { type: 'select', numeric: true, options: [[380, '3~380'], [220, '1~220']], struct: true, after: after })
            + '</div><p class="hint">Каталог ADL «Сервоприводы для трубопроводной арматуры», март 2025: мощность мотора и ток по времени поворота; * — стандартное время.</p>';
    }

    function show(res) {
        reg.length = 0;
        var e = ensureElss();
        var inp = UiHyd.inp;
        var h = [];

        h.push('<div class="card"><div class="ctitle"><b>Задание от ВК для ЭЛ и СС</b><span class="no-print">'
            + '<button type="button" class="small" data-e="xlsx-all">Скачать задание ЭЛ и СС (Excel по бланку)</button> '
            + '<button type="button" class="small" data-e="xlsx-el">Только для ЭЛ</button> '
            + '<button type="button" class="small" data-e="xlsx-ss">Только для СС</button></span></div>'
            + '<p class="hint">Насосные станции, водомерные узлы, квартирные счётчики и датчики давления берутся из расчёта и схемы и пересчитываются сами; '
            + 'мощность насосов — из подобранных каталожных листов (вкладка «Насосы»). У каждой строки впишите помещение и при необходимости примечание; '
            + 'то, чего на схеме нет, добавьте кнопкой «Добавить строку». «Только для ЭЛ» — строки с нагрузкой, «Только для СС» — строки с диспетчеризацией.</p>'
            + '<div id="elStatus"></div></div>');

        h.push('<div class="card no-print"><h2>Шапка бланка</h2><div class="form">'
            + inp('Шифр', e, 'cipher', { type: 'text', ph: '1-й этап' })
            + inp('Стадия', e, 'stage', { type: 'select', options: [['ЭП', 'ЭП'], ['П', 'П — проектная документация'], ['Р', 'Р — рабочая'], ['ТД', 'ТД — тендерная']] })
            + inp('Ревизия задания', e, 'revision', { type: 'text', ph: 'Р00' })
            + inp('Дата выдачи (пусто — сегодня)', e, 'date', { type: 'text', ph: 'ГГГГ-ММ-ДД' })
            + inp('Разработал', e, 'author', { type: 'text' })
            + inp('Выдал', e, 'issuedBy', { type: 'text' })
            + inp('Принял', e, 'acceptedBy', { type: 'text' })
            + '</div>' + inp('Описание объекта (пусто — название и адрес из проекта)', e, 'desc', { type: 'text', w: '100%' }) + '</div>');

        h.push('<div class="card" id="elTable"></div>');
        body.innerHTML = h.join('');
        table(res);
        refresh(res);
    }

    function table(res) {
        var el = document.getElementById('elTable');
        if (!el) return;
        var e = ensureElss();
        var list = HydElss.items(App.project, res && res.input ? res : null, hyd());
        var h = ['<div class="ctitle"><b>Оборудование в задании</b><span class="no-print"><button type="button" class="small" data-e="add">+ Добавить строку</button></span></div>'];

        if (!(res && res.input)) h.push('<p class="hint">Расчёта нет: на схеме нужен ввод и стояки — тогда автоматические строки появятся сами. Строки, добавленные вручную, работают и без расчёта.</p>');

        h.push('<div class="scroll"><table class="grid"><thead><tr><th>В задании</th><th class="left">Оборудование</th><th class="left">Помещение</th><th>Раб.</th><th>Рез.</th>'
            + '<th>кВт на ед.</th><th>В</th><th>Диспетчеризация</th><th class="left">Протокол</th><th class="left">Примечание</th><th></th></tr></thead><tbody>');

        list.forEach(function (it, n) {
            var cls = it.skip ? ' class="dim"' : '';
            var miss = it.miss.length ? '<div class="st-bad" style="font-size:11px">не заполнено: ' + esc(it.miss.join(', ')) + '</div>' : '';

            if (it.auto) {
                var o = e.auto[it.key] || {};
                var inc = { v: !it.skip };
                h.push('<tr' + cls + '><td>' + UiHyd.inp('', inc, 'v', { type: 'chk', bare: true, after: function (v) {
                    var a = e.auto[it.key] || (e.auto[it.key] = { room: '', note: '', name: '', dispatch: '', protocol: '', kw: null, volt: null, skip: false });
                    a.skip = !v;
                }, struct: true }) + '</td>'
                    + '<td class="left"><b>' + esc(it.title) + '</b>' + (it.name ? '<br><span class="note">' + esc(it.name) + '</span>' : '') + '<br><span class="note">из расчёта</span>' + miss + '</td>'
                    + '<td class="left">' + autoField({ key: it.key, room: it.room }, 'room', 'text', '150px') + '</td>'
                    + '<td>' + it.work + '</td><td>' + it.reserve + '</td>'
                    + '<td>' + autoField({ key: it.key, kw: it.kw }, 'kw', 'num', '64px', { min: 0 }) + '</td>'
                    + '<td>' + autoField({ key: it.key, volt: it.volt }, 'volt', 'num', '56px', { min: 0 }) + '</td>'
                    + '<td>' + autoField({ key: it.key, dispatch: it.dispatch }, 'dispatch', 'select', '', { options: [['Да', 'Да'], ['Нет', 'Нет']] }) + '</td>'
                    + '<td class="left">' + autoField({ key: it.key, protocol: it.protocol }, 'protocol', 'select', '', { options: protocolOptions() }) + '</td>'
                    + '<td class="left">' + autoField({ key: it.key, note: it.note }, 'note', 'text', '200px') + '</td><td></td></tr>');
                void o;
                return;
            }

            var r = e.rows[it.index];
            var catOpts = HydElss.CATEGORIES.map(function (c) { return [c.name, c.name]; });
            var applyDefaults = function (v) {
                var d = HydElss.catDefaults(v);
                r.dispatch = d.dispatch;
                r.protocol = d.protocol;
            };
            var inc2 = { v: !r.skip };

            h.push('<tr' + cls + '><td>' + UiHyd.inp('', inc2, 'v', { type: 'chk', bare: true, after: function (v) { r.skip = !v; }, struct: true }) + '</td>'
                + '<td class="left">' + UiHyd.inp('', r, 'cat', { type: 'select', bare: true, options: catOpts, struct: true, after: applyDefaults }) + '<br>'
                + manualField(r, 'name', 'text', '220px', {}) + miss + '</td>'
                + '<td class="left">' + manualField(r, 'room', 'text', '150px') + '</td>'
                + '<td>' + manualField(r, 'work', 'int', '52px', { min: 0 }) + '</td><td>' + manualField(r, 'reserve', 'int', '52px', { min: 0 }) + '</td>'
                + '<td>' + manualField(r, 'kw', 'num', '64px', { min: 0 }) + '</td><td>' + manualField(r, 'volt', 'num', '56px', { min: 0 }) + '</td>'
                + '<td>' + manualField(r, 'dispatch', 'select', '', { options: [['Да', 'Да'], ['Нет', 'Нет']] }) + '</td>'
                + '<td class="left">' + manualField(r, 'protocol', 'select', '', { options: protocolOptions() }) + '</td>'
                + '<td class="left">' + manualField(r, 'note', 'text', '200px') + '</td>'
                + '<td class="no-print"><button type="button" class="mini" data-e="del" data-arg="' + it.index + '">удалить</button></td></tr>');

            var descIdx = UiHyd.bind(r, 'desc', { type: 'text' });
            h.push('<tr' + cls + '><td></td><td class="left" colspan="10">'
                + (r.cat === HydElss.ACTUATOR_CAT ? actuatorPicker(r) : '')
                + '<textarea data-b="' + descIdx + '" rows="2" style="width:100%" placeholder="Описание для ЭЛ и СС: что за оборудование, как подключается, особые требования">' + esc(r.desc) + '</textarea></td></tr>');
        });

        if (!list.length) h.push('<tr><td colspan="11" class="note">Строк пока нет.</td></tr>');
        h.push('</tbody></table></div><p class="hint">Описание автоматических строк (мощность, Q и H насосов, марки счётчиков) формируется при выгрузке. '
            + 'Правки мощности, помещения, диспетчеризации и протокола у такой строки запоминаются; снять строку из задания — галочкой слева.</p>');
        el.innerHTML = h.join('');
    }

    function refresh(res) {
        res = res || UiHyd.result;
        var st = document.getElementById('elStatus');
        if (!st) return;
        var e = ensureElss();
        var list = HydElss.selected(HydElss.items(App.project, res && res.input ? res : null, hyd()), 'all');
        var noRoom = list.filter(function (x) { return x.miss.indexOf('помещение') >= 0; }).length;
        var noKw = list.filter(function (x) { return x.miss.indexOf('мощность') >= 0; }).length;
        var miss = [];

        if (!e.cipher) miss.push('шифр');
        if (!e.author) miss.push('«Разработал»');
        if (!e.issuedBy) miss.push('«Выдал»');
        if (!e.acceptedBy) miss.push('«Принял»');
        if (noRoom) miss.push('помещение у ' + noRoom + ' строк');
        if (noKw) miss.push('мощность насосных станций (загрузите каталожные листы на вкладке «Насосы»)');

        st.innerHTML = '<div class="verdict ' + (miss.length ? 'unknown' : 'ok') + '">Строк в задании: <b>' + list.length + '</b>. '
            + (miss.length ? 'Не заполнено: ' + esc(miss.join('; ')) + '.' : 'Всё заполнено.') + '</div>';
    }

    function save(mode, res) {
        var t = document.getElementById('hydHist');
        HydElss.save(App.project, res && res.input ? res : null, hyd(), mode).then(function () {
            if (t) t.textContent = 'Задание ' + (mode === 'ss' ? 'для СС' : mode === 'el' ? 'для ЭЛ' : 'для ЭЛ и СС') + ' выгружено в Excel';
        }, function (error) {
            if (t) t.textContent = 'Задание не выгружено: ' + error.message;
            console.error(error);
        });
    }

    function onClick(e, changed) {
        var b = e.target.closest('[data-e]');
        if (!b) return false;
        var act = b.getAttribute('data-e');
        var el = ensureElss();

        if (act === 'add') {
            el.rows.push({ cat: HydElss.CATEGORIES[3].name, name: '', desc: '', work: 1, reserve: 0, kw: null, volt: null, dispatch: 'Да', protocol: 'RS-485', room: '', note: '', skip: false, act: null });
            changed(true);
        } else if (act === 'del') {
            el.rows.splice(+b.getAttribute('data-arg'), 1);
            changed(true);
        } else if (act === 'xlsx-all') save('all', UiHyd.result);
        else if (act === 'xlsx-el') save('el', UiHyd.result);
        else if (act === 'xlsx-ss') save('ss', UiHyd.result);
        return true;
    }

    return { init: init, show: show, refresh: refresh, onClick: onClick };
})();
