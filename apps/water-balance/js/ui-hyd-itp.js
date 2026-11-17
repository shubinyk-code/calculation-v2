/*
    Вкладка «Гидравлика» → «Задание в ИТП»: «Задание на разработку блока ГВС теплового пункта».

    Всё, что есть в расчёте, подставляется само (отметки приборов, напор на вводе в ИТП, расходы
    Т3 и Т4, диаметры, тепловая нагрузка). Здесь вводится только то, чего в расчёте нет: шифр,
    стадия, ревизия, фамилии и допущения (температуры, доля циркуляции, потери в циркуляционных
    стояках). Ниже — таблица в том виде, как её увидит теплотехник; кнопка выгружает бланк бюро в Excel.
*/

var UiHydItp = (function () {
    'use strict';

    var esc = Format.html;
    var num = Format.num;
    var body, state, reg;

    function init(b, s, r) { body = b; state = s; reg = r; }

    function hyd() { return App.project.hyd; }

    function show(res) {
        reg.length = 0;
        var d = hyd();
        if (!d.itp) d.itp = HydModel.defaultItp();
        var p = d.itp;
        var inp = UiHyd.inp;
        var h = [];

        h.push('<div class="card"><div class="ctitle"><b>Задание в ИТП — блок ГВС</b><span class="no-print">'
            + '<button type="button" class="small" data-i="xlsx">Скачать задание (Excel по бланку)</button></span></div>'
            + '<p class="hint">Расходы, напоры, отметки, диаметры и тепловая нагрузка берутся из расчёта и пересчитываются при любой правке схемы. '
            + 'Заполните только шапку и допущения ниже. Формулы тепла в файле остаются формулами.</p><div id="hiStatus"></div></div>');

        h.push('<div class="card no-print"><h2>Шапка бланка</h2><div class="form">'
            + inp('Шифр (поле 1 формы 3 ГОСТ Р 21.1101)', p, 'cipher', { type: 'text', ph: 'ПБ-1303-2/26' })
            + inp('Стадия', p, 'stage', { type: 'select', options: [['ЭП', 'ЭП'], ['П', 'П — проектная документация'], ['Р', 'Р — рабочая'], ['ТД', 'ТД — тендерная']] })
            + inp('Ревизия задания', p, 'revision', { type: 'text', ph: '00' })
            + inp('Дата выдачи (пусто — сегодня)', p, 'date', { type: 'text', ph: 'ГГГГ-ММ-ДД' })
            + inp('Разработал', p, 'author', { type: 'text' })
            + inp('Выдал', p, 'issuedBy', { type: 'text' })
            + inp('Принял (в смежном отделе)', p, 'acceptedBy', { type: 'text' })
            + '</div></div>');

        h.push('<div class="card no-print"><h2>Температуры и допущения расчёта</h2><div class="form">'
            + inp('Температура ГВС на выходе из ИТП, °C', p, 'tHot', { min: 30, max: 95 })
            + inp('Температура циркуляции ГВС, °C', p, 'tCirc', { min: 30, max: 95 })
            + inp('Температура холодной воды (для тепла), °C', p, 'tCold', { min: 0, max: 30 })
            + inp('Циркуляция Т4 — доля секундного расхода Т3', p, 'circFactor', { min: 0, max: 1 })
            + inp('Потери в циркуляционных стояках жилья, м', p, 'circLossRes', { min: 0 })
            + inp('Потери в циркуляции встройки, м', p, 'circLossBuilt', { min: 0 })
            + inp('Скорость в циркуляционных трубах не более, м/с', p, 'vCirc', { min: 0.1, max: 3 })
            + '</div></div>');

        var nIdx = UiHyd.bind(p, 'notes', { type: 'text' });
        h.push('<div class="card no-print"><h2>Примечания к заданию (поле 4)</h2>'
            + '<textarea data-b="' + nIdx + '" rows="3" style="width:100%" placeholder="Указания разделу ТМ: тип балансировки стояков циркуляции, водяные полотенцесушители и т.п.">' + esc(p.notes) + '</textarea>'
            + '<p class="hint">Пункты про число вводов и узлы учёта в примечания добавляются сами.</p></div>');

        h.push('<div class="card" id="hiTable"></div>');
        body.innerHTML = h.join('');
        refresh(res);
    }

    function row(cells, strong) {
        return '<tr' + (strong ? ' class="total"' : '') + '>' + cells.map(function (c, i) {
            return '<td class="' + (i === 0 ? 'left' : '') + '">' + (c === null || c === undefined || c === '' ? '' : esc(c)) + '</td>';
        }).join('') + '</tr>';
    }

    function refresh(res) {
        res = res || UiHyd.result;
        var el = document.getElementById('hiTable');
        var st = document.getElementById('hiStatus');
        if (!el) return;

        if (!res || !res.input) { el.innerHTML = '<p class="hint">Задание строится по расчёту: на схеме нужен ввод и стояки.</p>'; return; }

        var d = HydItp.data(App.project, res, hyd());
        var p = d.p;

        if (!d.itps.length) {
            el.innerHTML = '<div class="verdict unknown">На схеме нет ИТП: поставьте «ИТП» и соедините его трубой с вводом на листе ХВС и с сетью ГВС на листе ГВС.</div>';
            if (st) st.innerHTML = '';
            return;
        }

        var miss = [];
        if (!p.cipher) miss.push('шифр');
        if (!p.author) miss.push('«Разработал»');
        if (!p.issuedBy) miss.push('«Выдал»');
        if (!p.acceptedBy) miss.push('«Принял»');
        if (st) st.innerHTML = miss.length ? '<div class="verdict unknown">Не заполнено в шапке: ' + miss.join(', ') + '.</div>' : '<div class="verdict ok">Шапка заполнена.</div>';

        var h = ['<h2>Что попадёт в задание</h2>'
            + (d.numbered
                ? '<p class="hint">ИТП пронумерованы на схеме: каждая ИТП с номером — <b>отдельное задание</b> (свой лист в Excel), ИТП без номера вместе образуют «общую». '
                    + 'В конце — сводный лист «Итого по комплексу».</p>'
                : (d.itps.length > 1 ? '<p class="hint">ИТП не пронумерованы — задание одно на всё здание. Чтобы выдать отдельные задания, на схеме выделите ИТП и поставьте галочку «Отдельное задание на эту ИТП» (номера 1, 2, 3 …).</p>' : ''))
            + '<div class="scroll"><table class="grid"><thead><tr><th class="left">Система</th><th>Макс. часовой, м³/ч</th><th>Секундный, л/с</th>'
            + '<th>Напор на выходе, м</th><th>Напор на входе, м</th><th>Труба Dн×d</th></tr></thead><tbody>'];

        d.groups.forEach(function (grp) {
            if (d.numbered) {
                var gt = grp.total;
                var gh = gt ? HydItp.heat(gt.hour, gt.circ, p) : null;
                h.push('<tr class="total"><td class="left" colspan="6"><b>' + esc(grp.label) + '</b>: ' + (gt
                    ? 'макс. часовой ' + num(gt.hour, 3) + ' м³/ч, секундный ' + num(gt.sec, 3) + ' л/с, циркуляция ' + num(gt.circ, 3) + ' л/с; нагрузка ' + num(gh.gcal, 4) + ' Гкал/ч · ' + num(gh.kw, 1) + ' кВт'
                    : 'нет потребителей ГВС') + '</td></tr>');
            }
            grp.itps.forEach(function (it) { itpRows(h, d, p, it); });
        });

        itpTail(h, d, p);
        el.innerHTML = h.join('');
    }

    /* Строки одной ИТП (зоны): отметки, напор, расходы и нагрузка. */
    function itpRows(h, d, p, it) {
        {
            var E = it.headIn === null ? null : it.headIn - d.hItp;
            h.push('<tr class="total"><td class="left" colspan="6">' + esc(it.name) + ' — зона ' + it.zone + ': нижний прибор ' + esc(HydItp.fmtElev(it.low)) + ', верхний ' + esc(HydItp.fmtElev(it.high))
                + ', напор ХВС на вводе ' + (it.headIn === null ? '—' : num(it.headIn, 2) + ' м') + '; материал: ' + esc(it.matName) + '</td></tr>');

            [['res', it.m3 + ' (жилье)', it.m4 + ' (жилье)', p.circLossRes], ['bi', it.b3 + ' (встройка)', it.b4 + ' (встройка)', p.circLossBuilt]].forEach(function (x) {
                var f = it[x[0]];
                if (!f) return;
                var hh = HydItp.heat(f.hour, f.circ, p);
                h.push(row([x[1], num(f.hour, 3), num(f.sec, 3), E === null ? '' : num(E, 2), '', f.pipeText + (f.pipe && !f.pipe.ok ? ' (скорость выше предела)' : '')]));
                h.push(row([x[2], num(f.circ * 3.6, 3), num(f.circ, 3), '', E === null ? '' : num(E - x[3], 2), f.circText]));
                h.push(row(['Гкал/ч · кВт', num(hh.gcal, 4), num(hh.kw, 1), '', '', '']));
            });

            if (it.res && it.bi) {
                var c = it.res.circ + it.bi.circ;
                var ha = HydItp.heat(it.all.hour, c, p);
                h.push(row(['Т3 общая (жильё + встройка)', num(it.all.hour, 3), num(it.all.sec, 3), '', '', it.all.pipeText]));
                h.push(row(['Гкал/ч · кВт', num(ha.gcal, 4), num(ha.kw, 1), '', '', '']));
            }
        }
    }

    function itpTail(h, d, p) {
        if (d.total) {
            var hm = HydItp.heat(d.total.hour, d.total.circ, p);
            var hs = HydItp.heat(d.total.avg, d.total.circ, p);
            h.push('<tr class="total"><td class="left" colspan="6">' + (d.numbered ? 'Итого по комплексу — свод по вероятности всех групп ГВС (нагрузки ИТП не суммируются)' : 'По зданию') + '</td></tr>');
            h.push(row(['Т3 общая (на вводе в здание)', num(d.total.hour, 3), num(d.total.sec, 3), '', '', '']));
            h.push(row(['Т3 среднечасовая', num(d.total.avg, 3), '', '', '', '']));
            h.push(row(['Максимум: Гкал/ч · кВт', num(hm.gcal, 4), num(hm.kw, 1), '', '', '']));
            h.push(row(['Среднее: Гкал/ч · кВт', num(hs.gcal, 4), num(hs.kw, 1), '', '', '']));
        }

        h.push('</tbody></table></div><p class="hint">Тепло: Q = q<sub>час</sub>·(t<sub>ГВС</sub> − t<sub>хол</sub>) + q<sub>цирк</sub>·(t<sub>ГВС</sub> − t<sub>цирк</sub>), 1 Гкал/ч = 1163 кВт. '
            + 'Диаметры подобраны по скорости (магистрали ' + num(hyd().survey.vmax.mains, 1) + ' м/с, циркуляция ' + num(p.vCirc, 1) + ' м/с); при необходимости поправьте в Excel.</p>');
    }

    function onClick(e) {
        var b = e.target.closest('[data-i]');
        if (!b) return false;
        var st = document.getElementById('hydHist');

        if (b.getAttribute('data-i') === 'xlsx') {
            HydItp.save(App.project, UiHyd.result, hyd()).then(function () {
                if (st) st.textContent = 'Задание в ИТП выгружено в Excel';
            }, function (error) {
                if (st) st.textContent = 'Задание не выгружено: ' + error.message;
                console.error(error);
            });
        }
        return true;
    }

    return { init: init, show: show, refresh: refresh, onClick: onClick };
})();
