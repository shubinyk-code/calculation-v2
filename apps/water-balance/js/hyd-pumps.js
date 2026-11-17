/*
    Подбор насосных установок по каталожным листам.

    Расчёт даёт для каждой насосной установки требуемые подачу Qтр (л/с) и напор
    Hтр (м). Установка подбирается в каталоге (лист Wilo), а в таблицу записки идут
    марка, зона, мощность Р2, количество насосов и фактическая рабочая точка Qф, Hф.
    Условие подбора: Qф ≥ Qтр и Hф ≥ Hтр.

    Лист читается по подписям (устроен одинаково):

        Тип: …                        марка установки, первая строка с «CO …»
        Назначение: ХВС 1 зона        по нему лист ложится на свою систему
        Исходные параметры            подача и напор, которые были заданы при подборе
        Фактическая рабочая точка     подача, напор, мощность P2, КПД, NPSH
        Данные мотора                 номинальная мощность, ток, обороты
        Кол-во рабочих и резервных    в таблицу идёт как «2+1»

    В листах старого образца подписи набраны с разрядкой («На по р»), поэтому все
    подписи ищутся «свободно»: между буквами допускаются пробелы.

    Выбор хранится в hyd.pumpSel[id насоса] и переживает пересчёт схемы.
*/

var HydPumps = (function () {
    'use strict';

    /** Подпись с возможными пробелами между буквами: «На по р» = «Напор». */
    function loose(label) {
        return new RegExp(label.split('').map(function (ch) {
            return /[a-zA-Zа-яА-Я0-9]/.test(ch) ? ch + '\\s*' : ch === ' ' ? '\\s*' : '\\' + ch + '\\s*';
        }).join(''), 'i');
    }

    /*
        Число после подписи. «P2» в хвосте подписи («Ном. мощность Р2 0,75 kW»)
        отбрасывается, иначе двойка приклеивается к числу и получается 20,75.
    */
    function num(text) {
        if (!text) return null;
        var clean = String(text).replace(/[PР]\s*2\b/g, ' ');
        var m = /(-?\d+(?:\s?[.,]\s?\d+)?)/.exec(clean);
        return m ? Number(m[1].replace(/\s/g, '').replace(',', '.')) : null;
    }

    function valueAfter(line, label) {
        var m = loose(label).exec(line);
        return m ? num(line.slice(m.index + m[0].length)) : null;
    }

    function textAfter(line, label) {
        var m = loose(label).exec(line);
        return m ? line.slice(m.index + m[0].length).replace(/^[\s:.]+/, '').trim() : null;
    }

    function has(line, label) { return loose(label).test(line); }

    /*
        Подача в листе бывает в л/с и в м³/ч. Единица ищется в самой строке; если её нет,
        берётся л/с, как в таблице записки. 1 л/с = 3,6 м³/ч.
    */
    function toLs(value, line) {
        if (value === null) return null;
        var m3h = /м\s*[³3]?\s*\/\s*ч|m\s*[³3]?\s*\/\s*h/i.test(line);
        return m3h ? Math.round(value / 3.6 * 1000) / 1000 : value;
    }

    /* --- разбор листа --------------------------------------------------------- */

    function parse(pages, fileName) {
        var lines = [];
        pages.forEach(function (p) {
            p.lines.forEach(function (l) { lines.push(l.text); });
        });

        var sheet = {
            file: fileName || '', name: '', purpose: '', project: '',
            duty: { Q: null, H: null },
            actual: { Q: null, H: null, P2: null, eff: null, npsh: null },
            power: null, current: null, speed: null, working: null, standby: null,
            pumpType: '', control: '', dn: '', lines: lines
        };

        var mode = '';

        lines.forEach(function (line) {
            if (!sheet.name) {
                // Марка установки: «CO 2 MVL 2003/SK-FFS-R-CS», «COR-3 MVL 806/SKw-EB-R».
                var name = /((?:COR|CO)[\s-]?\d[^\n]*?\/[^\s]+)/.exec(line);
                // В старых листах буквы набраны врозь: «M VL 404» — склеиваем.
                if (name) sheet.name = name[1].trim().replace(/\b([A-Z])\s+(?=[A-Z]{2,})/g, '$1');
            }

            if (!sheet.purpose && has(line, 'Назначение')) sheet.purpose = textAfter(line, 'Назначение') || '';
            if (!sheet.project && has(line, 'Проект')) sheet.project = textAfter(line, 'Проект') || '';

            if (has(line, 'Исходные параметры') || has(line, 'Данные запроса')) mode = 'duty';
            else if (has(line, 'Фактическая рабочая точка') || has(line, 'Рабочая точка')) mode = 'actual';
            else if (has(line, 'Данные продукта') || has(line, 'Материалы') || has(line, 'Подсоединение')) mode = '';
            else if (has(line, 'Данные мотора') || has(line, 'Данные насоса')) mode = 'motor';

            if (mode === 'duty' || mode === 'actual') {
                var target = mode === 'duty' ? sheet.duty : sheet.actual;
                if (target.Q === null && (has(line, 'Подача') || has(line, 'Расход'))) target.Q = toLs(valueAfter(line, has(line, 'Подача') ? 'Подача' : 'Расход'), line);
                if (target.H === null && has(line, 'Напор')) target.H = valueAfter(line, 'Напор');
                if (mode === 'actual') {
                    if (sheet.actual.P2 === null && has(line, 'Мощность P2')) sheet.actual.P2 = valueAfter(line, 'Мощность P2');
                    if (sheet.actual.eff === null && has(line, 'КПД')) sheet.actual.eff = valueAfter(line, 'КПД');
                    if (sheet.actual.npsh === null && has(line, 'NPSH')) sheet.actual.npsh = valueAfter(line, 'NPSH');
                }
            }

            if (mode === 'actual' && sheet.actual.P2 === null && has(line, 'Мощность на валу')) sheet.actual.P2 = valueAfter(line, 'Мощность на валу');
            if (sheet.power === null && has(line, 'Номинальная мощность')) sheet.power = valueAfter(line, 'Номинальная мощность');
            if (sheet.power === null && has(line, 'Ном. мощность')) sheet.power = valueAfter(line, 'Ном. мощность');
            if (sheet.current === null && has(line, 'Номинальный ток')) sheet.current = valueAfter(line, 'Номинальный ток');
            if (sheet.speed === null && has(line, 'частота вращения')) sheet.speed = valueAfter(line, 'частота вращения');
            if (sheet.working === null && has(line, 'Кол-во рабочих')) sheet.working = valueAfter(line, 'Кол-во рабочих');
            if (sheet.standby === null && has(line, 'Кол-во резервных')) sheet.standby = valueAfter(line, 'Кол-во резервных');
            if (!sheet.pumpType && has(line, 'Тип насосов')) sheet.pumpType = textAfter(line, 'Тип насосов') || '';
            if (!sheet.control && has(line, 'Прибор управления')) {
                var value = textAfter(line, 'Прибор управления') || '';
                if (/\d/.test(value)) sheet.control = value;
            }
            if (!sheet.dn && /DNs/.test(line)) sheet.dn = (textAfter(line, 'DNs') || '').trim();
        });

        if (!sheet.name && fileName) {
            var fromFile = /((?:CO|COR)[\s-]?\d[^.]*)/.exec(fileName.replace(/_/g, '/'));
            if (fromFile) sheet.name = fromFile[1].trim();
        }

        sheet.count = countText(sheet);
        sheet.role = roleOf(sheet);
        sheet.ok = !!(sheet.name && (sheet.actual.H || sheet.duty.H));
        return sheet;
    }

    /* Жокей-насос не должен вытеснять лист основной установки той же системы. */
    function roleOf(sheet) {
        var text = (sheet.purpose + ' ' + sheet.file + ' ' + sheet.name).toLowerCase();
        if (/жокей|jockey/.test(text)) return 'jockey';
        if (/\/j-et|j-et-r/i.test(sheet.name)) return 'jockey';
        if (/^(?:cor|co)[\s-]?1\b/i.test(sheet.name) && sheet.duty.Q !== null && sheet.duty.Q < 2) return 'jockey';
        return 'main';
    }

    function countText(sheet) {
        var work = sheet.working > 0 ? Math.round(sheet.working) : null;
        var spare = sheet.standby > 0 ? Math.round(sheet.standby) : null;
        if (work === null && spare === null) return '';
        return (work || 0) + (spare ? '+' + spare : '');
    }

    /* --- к какой системе относится лист ---------------------------------------- */

    function zoneOf(text) {
        var m = /(\d+)\s*зон/i.exec(text || '');
        return m ? Number(m[1]) : null;
    }

    /*
        Сколько признаков листа совпало с установкой: номер зоны в назначении и в
        названии насоса, слова ХВС/ГВС, близость заданного напора и подачи к
        расчётным. Возвращает число (больше — лучше).
    */
    function score(sheet, sys) {
        var text = (sheet.purpose + ' ' + sheet.file).toLowerCase();
        var p = sys.pump;
        var points = 0;
        var zone = zoneOf(text);
        var mine = zoneOf(sys.name);

        if (zone !== null && mine !== null) points += zone === mine ? 4 : -2;
        if (sys.name && text.indexOf(sys.name.toLowerCase()) >= 0) points += 3;

        var hot = /гвс|горяч/.test(text);
        var cold = /хвс|холодн/.test(text);
        var hotSys = sys.dict && sys.dict.leaf && sys.dict.leaf.net === 'h';
        if (hot && hotSys) points += 1;
        if (cold && !hotSys && sys.dict) points += 1;

        var H = sheet.duty.H || sheet.actual.H;
        if (H && p && p.hp > 0) {
            var diff = Math.abs(H - p.hp) / Math.max(p.hp, 1);
            points += diff < 0.02 ? 3 : diff < 0.1 ? 2 : diff < 0.25 ? 1 : 0;
        }

        var Q = sheet.duty.Q || sheet.actual.Q;
        if (Q && p && p.q > 0) {
            var dq = Math.abs(Q - p.q) / Math.max(p.q, 0.2);
            points += dq < 0.05 ? 2 : dq < 0.2 ? 1 : 0;
        }

        return points;
    }

    /*
        Раскладка листов по системам: каждому листу — лучшая система, каждой системе —
        лучший лист. Возвращает { assigned: {sysId: sheet}, skipped: [{sheet, why}] }.
    */
    function assign(sheets, systems) {
        var pumped = systems.filter(function (s) { return s.pump && s.pump.pumped; });
        var best = {};
        var skipped = [];

        sheets.forEach(function (sheet) {
            if (!sheet.ok) { skipped.push({ sheet: sheet, why: 'не удалось прочитать марку и рабочую точку' }); return; }
            if (sheet.role === 'jockey') { skipped.push({ sheet: sheet, why: 'жокей-насос — в таблицу основных установок не входит' }); return; }

            var top = null;
            var topScore = 0;
            pumped.forEach(function (sys) {
                var sc = score(sheet, sys);
                if (sc > topScore) { topScore = sc; top = sys; }
            });

            if (!top) { skipped.push({ sheet: sheet, why: 'не нашлось насосной установки с похожей зоной и напором' }); return; }
            if (best[top.id] && best[top.id].score >= topScore) {
                skipped.push({ sheet: sheet, why: 'для «' + top.name + '» уже есть более подходящий лист' });
                return;
            }
            if (best[top.id]) skipped.push({ sheet: best[top.id].sheet, why: 'для «' + top.name + '» нашёлся более подходящий лист' });
            best[top.id] = { sheet: sheet, score: topScore };
        });

        var assigned = {};
        Object.keys(best).forEach(function (id) { assigned[id] = best[id].sheet; });
        return { assigned: assigned, skipped: skipped };
    }

    /* Данные листа в запись выбора. */
    function fromSheet(sheet) {
        return {
            name: sheet.name,
            purpose: sheet.purpose || '',
            power: sheet.power !== null ? sheet.power : (sheet.actual.P2 !== null ? sheet.actual.P2 : null),
            count: sheet.count || '',
            Qf: sheet.actual.Q !== null ? sheet.actual.Q : null,
            Hf: sheet.actual.H !== null ? sheet.actual.H : null,
            sheet: sheet.file,
            P2: sheet.actual.P2,
            npsh: sheet.actual.npsh,
            control: sheet.control || '',
            pumpType: sheet.pumpType || '',
            dutyQ: sheet.duty.Q, dutyH: sheet.duty.H, loadedAt: today(),
            data: sheet.data || '',
            source: 'sheet'
        };
    }

    function today() {
        var d = new Date();
        return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear();
    }

    /*
        Положить лист в строку установки. Возвращает запись для отчёта «было → стало»:
        replaced — марка поменялась, updated — та же марка, лист обновлён, added — строки не было.
    */
    function place(hyd, sys, sheet) {
        var old = hyd.pumpSel[sys.id];
        var next = fromSheet(sheet);
        hyd.pumpSel[sys.id] = next;

        if (old && old.name && old.name !== next.name) return { kind: 'replaced', text: sys.name + ': ' + old.name + ' → ' + next.name };
        if (old && old.name) return { kind: 'updated', text: sys.name + ': ' + next.name + ' — лист обновлён' };
        return { kind: 'added', text: sys.name + ': ' + next.name };
    }

    var Q_TOL = 0.10;      // расход подбора и заданной точки не должен расходиться с расчётом больше чем на 10 %
    var H_TOL = 0.05;      // напор заданной точки — больше чем на 5 % (и не меньше 1 м)

    function pct(x) { return Math.round(x * 100) + ' %'; }

    /*
        Расхождение заданной в листе точки (то, под что подбирали в каталоге) с расчётом: подбирали под
        другой расход или напор — пора перезагрузить лист или пересчитать. Расход — больше 10 %, напор —
        больше 5 % (не меньше 1 м).
    */
    function drift(sel, p) {
        if (!sel || !p) return '';
        var parts = [];

        if (sel.dutyQ > 0 && p.q > 0 && Math.abs(sel.dutyQ - p.q) > p.q * Q_TOL) {
            parts.push('расход ' + String(sel.dutyQ).replace('.', ',') + ' л/с против ' + p.q.toFixed(2).replace('.', ',') + ' по расчёту (' + pct(Math.abs(sel.dutyQ - p.q) / p.q) + ')');
        }
        if (sel.dutyH > 0 && p.hp > 0 && Math.abs(sel.dutyH - p.hp) > Math.max(1, p.hp * H_TOL)) {
            parts.push('напор ' + String(sel.dutyH).replace('.', ',') + ' м против ' + p.hp.toFixed(1).replace('.', ',') + ' по расчёту');
        }

        return parts.length ? 'в листе задана другая точка: ' + parts.join('; ') + ' — подбор выполнен не под этот расчёт, проверьте' : '';
    }

    function blankSel() {
        return { name: '', purpose: '', power: null, count: '', Qf: null, Hf: null, sheet: '', P2: null, npsh: null, control: '', pumpType: '', dutyQ: null, dutyH: null, loadedAt: '', data: '', source: 'manual' };
    }

    /* --- проверка и строки таблицы --------------------------------------------- */

    function countOf(node, sel) {
        if (sel && sel.count) return sel.count;
        var w = node && node.work > 0 ? node.work : 1;
        var r = node && node.reserve > 0 ? node.reserve : 0;
        return w + (r ? '+' + r : '');
    }

    /*
        Соответствие подбора расчёту. Допуск на сравнение 0,005 л/с и 0,05 м — это
        округление в листе; ниже требуемого — «не проходит».
    */
    function check(sel, p) {
        var out = { qOk: null, hOk: null, ok: null, text: '', qDev: null, qWarn: '', drift: '' };
        if (!sel || !p) return out;
        var msgs = [];

        out.drift = drift(sel, p);

        if (sel.Qf !== null && isFinite(sel.Qf)) {
            out.qOk = sel.Qf >= p.q - 0.005;
            if (!out.qOk) msgs.push('Qф ' + sel.Qf + ' < Qтр ' + p.q.toFixed(3) + ' л/с');
            if (p.q > 0) {
                out.qDev = (sel.Qf - p.q) / p.q;
                // насос проходит, но расход намного больше расчётного — подобрали «на вырост», скорее всего не оптимально
                if (out.qOk && out.qDev > Q_TOL) out.qWarn = 'Qф ' + String(sel.Qf).replace('.', ',') + ' л/с больше Qтр ' + p.q.toFixed(2).replace('.', ',') + ' на ' + pct(out.qDev)
                    + ' — подбор, вероятно, неоптимален (насос с запасом по расходу)';
            }
        }
        if (sel.Hf !== null && isFinite(sel.Hf)) {
            out.hOk = sel.Hf >= p.hp - 0.05;
            if (!out.hOk) msgs.push('Hф ' + sel.Hf + ' < Hтр ' + p.hp.toFixed(1) + ' м');
        }
        if (out.qOk !== null && out.hOk !== null) out.ok = out.qOk && out.hOk;
        out.text = msgs.join('; ');
        return out;
    }

    /* Строки Таблицы 3: [Наименование, Зона, Р2, Кол-во, Qтр, Hтр, Qф, Hф] по каждой насосной установке. */
    function rows(result, hyd) {
        var out = [];
        var sel = hyd.pumpSel || {};

        result.systems.forEach(function (sys) {
            var p = sys.pump;
            if (!p || !p.pumped) return;
            var s = sel[sys.id];
            out.push({
                id: sys.id, sys: sys, sel: s || null, check: check(s, p),
                cells: [
                    s && s.name ? s.name : '—',
                    zoneOf(sys.name) !== null ? zoneOf(sys.name) : sys.name,
                    s && s.power !== null && s.power !== undefined ? String(s.power).replace('.', ',') : '',
                    countOf(sys.node, s),
                    round(p.q, 3), round(p.hp, 1),
                    s && s.Qf !== null && s.Qf !== undefined ? s.Qf : '',
                    s && s.Hf !== null && s.Hf !== undefined ? s.Hf : ''
                ]
            });
        });

        return out;
    }

    function round(x, d) { var k = Math.pow(10, d); return Math.round(x * k) / k; }

    var HEAD = ['Наименование', 'Зона', 'Р2, кВт', 'Кол-во (раб.,рез)', 'Qтр, л/с', 'Hтр, м', 'Qф, л/с', 'Hф, м'];

    /* Блоки для Word/Excel. */
    function blocks(result, hyd) {
        var list = rows(result, hyd);
        var out = [{ kind: 'title', text: 'Таблица 3' }];

        out.push({
            kind: 'table',
            head: HEAD,
            widths: [44, 16, 10, 16, 12, 10, 12, 10],
            digits: [null, 0, null, null, 3, 1, 2, 2],
            rows: list.map(function (r) { return r.cells; })
        });

        var bad = list.filter(function (r) { return r.check.ok === false; });
        if (bad.length) {
            out.push({ kind: 'note', text: 'Рабочая точка ниже требуемой: ' + bad.map(function (r) { return r.sys.name + ' (' + r.check.text + ')'; }).join('; ') + '.' });
        }
        var none = list.filter(function (r) { return !r.sel; });
        if (none.length) {
            out.push({ kind: 'note', text: 'Установка не подобрана: ' + none.map(function (r) { return r.sys.name; }).join(', ') + '.' });
        }

        return out;
    }

    function sheetOf(result, hyd) { return { name: 'Насосы', blocks: blocks(result, hyd) }; }

    /* --- чтение файла ----------------------------------------------------------- */

    function read(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () {
                // сам файл хранится в проекте (base64): по нему ставится штамп «Приложение N» в пакете листов
                var data = Zip.toBase64(new Uint8Array(reader.result));
                Pdf.read(reader.result).then(function (pages) {
                    var sheet = parse(pages, file.name);
                    sheet.data = data;
                    resolve(sheet);
                }).catch(reject);
            };
            reader.onerror = function () { reject(reader.error); };
            reader.readAsArrayBuffer(file);
        });
    }

    return {
        HEAD: HEAD, countOf: countOf, place: place, drift: drift, Q_TOL: Q_TOL, parse: parse, read: read, assign: assign, score: score, fromSheet: fromSheet, blankSel: blankSel,
        check: check, rows: rows, blocks: blocks, sheetOf: sheetOf, loose: loose, valueAfter: valueAfter, zoneOf: zoneOf
    };
})();
