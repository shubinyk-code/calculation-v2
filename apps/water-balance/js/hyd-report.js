/*
    Выгрузка гидравлики в Excel: напоры насосных установок, таблица участков,
    исходные данные расчёта. Модель листов — та же, что у Report (см. xlsx.js):
    числа уходят числами, чтобы инженер мог считать дальше.
*/

var HydReport = (function () {
    'use strict';

    var CHANNEL = { total: 'общий', cold: 'холодный', hot: 'горячий' };

    function today() {
        var d = new Date();
        var two = function (n) { return (n < 10 ? '0' : '') + n; };
        return two(d.getDate()) + '.' + two(d.getMonth() + 1) + '.' + d.getFullYear();
    }

    function fileName() {
        var p = App.project;
        var name = (p.hyd && p.hyd.survey.objectName) || p.object.name
            || (p.name && p.name !== 'Без названия' ? p.name : 'Гидравлика ВК');
        return name + ' — гидравлика — ' + today() + '.xlsx';
    }

    function num(x) { return typeof x === 'number' && isFinite(x) ? x : ''; }

    function headSheet(result, hyd) {
        var blocks = [];
        var s = hyd.survey;

        blocks.push({ kind: 'title', text: 'Расчёт напоров насосных установок' });
        blocks.push({
            kind: 'note',
            text: 'Hp = Hgeom + ΣHl,tot + Hпр − Hгар; ΣHl,tot = ΣHl + ΣHм + Hнс + Hитп + Hв + Hсч+ф. '
                + 'Способ вероятности: ' + (hyd.method === 'fixtures' ? 'по приборам' : 'по людям')
                + '. Циркуляция Т4 в Hтр ГВС не учтена.'
        });

        var rows = [];

        result.systems.forEach(function (sys) {
            var p = sys.pump;
            if (!p) return;
            rows.push([sys.name, p.pumped ? (p.needed ? 'насос' : 'насос не нужен') : 'городская сеть',
                num(p.q), num(p.qM3h), num(p.hp), num(p.hgar), num(p.req), num(p.maxStatic), p.regs,
                sys.dict.leaf.label + ' (' + (sys.dict.leaf.net === 'c' ? 'ХВС' : 'ГВС') + ')']);
        });

        blocks.push({
            kind: 'table',
            head: ['Система', 'Установка', 'Qтр, л/с', 'Qтр, м³/ч', 'Hтр, м', 'Hгар, м', 'Нужно у ввода, м', 'Статика внизу, м', 'Регуляторов', 'Диктующий прибор'],
            widths: [26, 18, 11, 11, 10, 10, 14, 14, 12, 28],
            digits: 3,
            rows: rows
        });

        result.systems.forEach(function (sys) {
            if (!sys.dict) return;
            var p = sys.dict.part;
            var pumped = sys.kind === 'pump';

            blocks.push({ kind: 'title', text: 'Расчёт напоров — ' + sys.name });

            var lines = [
                ['Hgeom', 'отметка прибора − отметка ' + (pumped ? 'оси насосов' : 'ввода'), p.geom],
                ['Hl кв', 'потери по длине, квартирная разводка', p.lApt],
                ['Hl ст', 'потери по длине, стояки и этажные ветки', p.lRiser],
                ['Hl маг', 'потери по длине, магистрали и ввод', p.lMains],
                ['ΣHl', 'сумма потерь по длине', p.sumL],
                ['Hмест', 'Kl · ΣHl, Kl = ' + s.kl, p.local],
                ['Hсч кв+ф', 'квартирный счётчик с фильтром', p.mApt],
                ['Hсч+ф секц', 'счётчик секции / встроенного с фильтром', p.mSec],
                ['Hрег.д+ф', 'регулятор давления', p.reg],
                ['Hнс', 'насосная станция', p.ns],
                ['Hитп', 'ИТП', p.itp],
                ['Hв', 'потери во вводе', p.hv],
                ['Hсч+ф', 'водомерный узел на вводе с фильтром', p.main],
                ['ΣHl,tot', 'итого потерь', p.tot],
                ['Hпр', 'свободный напор у прибора', p.pr],
                ['Hгар', 'гарантированный напор', result.input.input.Hgar],
                [pumped ? 'Hp' : 'Hизб', pumped ? 'Hgeom + ΣHl,tot + Hпр − Hгар' : 'Hгар − Hgeom − ΣHl,tot − Hпр',
                    pumped ? sys.pump.hp : result.input.input.Hgar - p.req]
            ];

            blocks.push({
                kind: 'table',
                head: ['Обозначение', 'Что это', 'Значение, м'],
                widths: [16, 52, 14],
                digits: 2,
                rows: lines,
                total: lines.length - 1
            });

            if (sys.route) {
                blocks.push({ kind: 'title', text: 'Расчётные точки диктующего пути — ' + sys.name });
                blocks.push({
                    kind: 'table',
                    head: ['Точки', 'Участок', 'q, л/с', 'Труба', 'L, м', 'V, м/с', 'i, мм/м', 'Hl, м', 'Hмест, м', 'Оборудование, м', 'Напор насоса, м', 'Подъём на участке, м', 'Напор в начале, м', 'Напор в конце, м'],
                    widths: [8, 42, 9, 14, 8, 8, 9, 9, 10, 12, 12, 12, 13, 13],
                    digits: 3,
                    rows: sys.route.sections.map(function (r) {
                        return [r.no + ' → ' + (r.no + 1), r.name, num(r.q), r.size ? r.size.label : '', num(r.L), r.size ? num(r.size.v) : '', r.size ? num(r.size.iMm) : '',
                            num(r.hFr), num(r.local), num(r.equip), num(r.gain), num(r.dz), num(r.dynStart), num(r.dynEnd)];
                    })
                });
            }
        });

        return { name: 'Напоры', blocks: blocks };
    }

    function rowsSheet(result) {
        var blocks = [];
        blocks.push({ kind: 'title', text: 'Участки: расход, диаметр, потери' });
        blocks.push({ kind: 'note', text: 'Расход — по СП 30.13330.2020, раздел 5, q = 5·q₀·α. i — удельные потери, мм/м; h — потери по длине участка, м.' });

        var groups = [{ name: 'Ввод и участки до насосных установок / питание от города', segs: result.segs.filter(function (s) { return s.sys === ''; }) }];

        result.systems.forEach(function (sys) {
            if (sys.kind === 'pump') groups.push({ name: 'После насоса: ' + sys.name, segs: sys.segs });
        });

        groups.forEach(function (sys) {
            var rows = [];

            sys.segs.forEach(function (s) {
                var r = s.res;
                var z = r.size;
                rows.push([s.id, s.name, s.net === 'c' ? 'ХВС' : 'ГВС', CHANNEL[s.ch],
                    r.U, r.N, num(r.P), num(r.alpha), num(r.q),
                    z ? z.label : '', z ? z.dn : '', num(s.L), z ? num(z.v) : '', z ? num(z.iMm) : '', z ? num(z.h) : '',
                    r.meter && r.meter.pick ? r.meter.mark : '', r.meter && r.meter.pick ? num(r.meter.h) : '']);
            });

            blocks.push({ kind: 'title', text: sys.name });
            blocks.push({
                kind: 'table',
                head: ['Код', 'Участок', 'Сеть', 'Канал', 'U', 'N', 'P', 'α', 'q, л/с', 'Труба', 'Ду', 'L, м', 'V, м/с', 'i, мм/м', 'h, м', 'Узел учёта', 'h узла, м'],
                widths: [26, 30, 7, 10, 7, 7, 10, 8, 10, 14, 6, 8, 8, 9, 9, 18, 10],
                digits: 3,
                rows: rows
            });
        });

        return { name: 'Участки', blocks: blocks };
    }

    function inputSheet(result, hyd) {
        var s = hyd.survey;
        var inp = result.input ? result.input.input : { Hgar: '', material: 'pe100s17', od: 160, wall: 9.5, length: '' };
        var rows = [
            ['Объект', s.objectName],
            ['Высота здания, м', s.height],
            ['Паркинг', { none: 'нет', underground: 'подземный', above: 'надземный' }[s.parking]],
            ['Способ вероятности', hyd.method === 'fixtures' ? 'по приборам' : 'по людям'],
            ['Гарантированный напор Hгар, м', inp.Hgar],
            ['Ввод', HydData.find(inp.material, inp.od, inp.wall).label + ', ' + HydData.material(inp.material).name + ', L=' + inp.length + ' м'],
            ['Магистрали', HydData.material(s.materials.mains).name],
            ['Стояки', HydData.material(s.materials.risers).name],
            ['Квартирная разводка', HydData.material(s.materials.apartment).name],
            ['Предельная скорость: магистрали / стояки / квартира / ввод, м/с',
                s.vmax.mains + ' / ' + s.vmax.risers + ' / ' + s.vmax.apartment + ' / ' + s.vmax.input],
            ['Kl (местные потери)', s.kl],
            ['Hпр, м', s.hPr],
            ['Hнс, м', s.hNs],
            ['Hитп, м', s.hItp],
            ['Регулятор давления, м', s.hReg],
            ['Фильтр у счётчика, м', s.hFilter],
            ['Статика, при которой нужен регулятор, м', s.staticLimit],
            ['Потери счётчиков', s.meter.method === 'passport' ? 'по паспорту завода' : 'по СП (S·q²)'],
            ['Людей по модели', result.people]
        ];

        return {
            name: 'Исходные данные',
            blocks: [
                { kind: 'title', text: 'Исходные данные гидравлического расчёта' },
                { kind: 'table', head: ['Параметр', 'Значение'], widths: [60, 60], digits: 2, rows: rows }
            ]
        };
    }

    /*
        Водомерные узлы схемы в виде строк таблицы подбора: место, система, расход,
        выбранный счётчик (автоподбор или вручную), метод потерь. Квартирные счётчики
        сюда не входят — они считаются автоматически и показаны сводкой.
    */
    function meterRows(result, hyd) {
        var rows = [];

        result.net.segs.forEach(function (s) {
            if (s.dev !== 'meter' || !s.res.meter || !s.res.meter.pick || !s.res.meter.pick.c) return;
            var n = HydModel.nodeById(hyd, s.node);
            var m = s.res.meter;
            var role = { main: 'Ввод', section: 'Секция', builtin: 'Встроенное помещение' }[n.role];
            var method = n.method || hyd.survey.meter.method;

            rows.push({
                node: n, seg: s, qLs: m.q, c: m.pick.c, method: method,
                place: n.place || (role + (s.net === 'h' ? ' (ГВС)' : ' (ХВС)')),
                systemName: n.systemName || (s.net === 'h' ? 'Горячее водоснабжение' : 'Холодное водоснабжение'),
                note: n.note || (method === 'sp' ? HydMeter.SP_NOTE : ''),
                manual: m.manual
            });
        });

        return rows;
    }

    /* Сводка квартирных счётчиков: сколько каких марок подобрано. */
    function aptMeters(result) {
        var map = {};

        result.net.segs.forEach(function (s) {
            if (s.meter !== 'apt' || !s.res.meter || !s.res.meter.pick || !s.res.meter.pick.c) return;
            var key = (s.net === 'h' ? 'ГВС ' : 'ХВС ') + s.res.meter.mark;
            map[key] = (map[key] || 0) + 1;
        });

        return Object.keys(map).sort().map(function (k) { return k + ' — ' + map[k] + ' шт.'; });
    }

    function meterTable(rows) {
        return {
            kind: 'table',
            head: ['№', 'Место установки', 'Система', 'Q, л/с', 'Марка счётчика', 'DN', 'Тип', 'h, м', 'Предел, м', 'Статус', 'Примечание'],
            widths: [5, 22, 28, 9, 22, 6, 13, 8, 9, 20, 36],
            digits: 3,
            rows: rows.map(function (r, i) {
                var loss = r.method === 'passport' ? r.c.hPassport : r.c.hSp;
                return [i + 1, r.place, r.systemName, r.qLs, r.c.markFull, r.c.dn, r.c.kindName, loss, r.c.limit, r.c.status + (r.manual ? ' (выбран вручную)' : ''), r.note];
            })
        };
    }

    function metersSheet(result, hyd) {
        var rows = meterRows(result, hyd);
        var blocks = [{ kind: 'title', text: 'Таблица подбора счётчиков' }];

        blocks.push(meterTable(rows));
        blocks.push({ kind: 'note', text: 'Все счётчики предусмотрены ' + (hyd.survey.meter.pulse ? 'с импульсным выходом.' : 'без импульсного выхода.') });

        var apt = aptMeters(result);
        if (apt.length) blocks.push({ kind: 'note', text: 'Квартирные счётчики: ' + apt.join('; ') + '.' });

        return { name: 'Счётчики', blocks: blocks };
    }

    /* Документ Word: таблица подбора и расчёт потерь по каждому счётчику. */
    function metersDoc(result, hyd) {
        var rows = meterRows(result, hyd);
        var blocks = [{ kind: 'title', text: 'Таблица подбора счётчиков.' }, meterTable(rows)];

        blocks.push({ kind: 'note', text: 'Все счётчики предусмотрены ' + (hyd.survey.meter.pulse ? 'с импульсным выходом.' : 'без импульсного выхода.') });

        var apt = aptMeters(result);
        if (apt.length) blocks.push({ kind: 'note', text: 'Квартирные счётчики: ' + apt.join('; ') + '.' });

        blocks.push({ kind: 'title', text: 'Расчёт потерь напора в счётчиках воды' });

        HydMeter.reportLines(rows.map(function (r) {
            return { place: r.place, systemName: r.systemName, qLs: r.qLs, c: r.c, method: r.method, note: r.note };
        }), hyd.survey.meter).forEach(function (line) {
            blocks.push({ kind: 'mono', text: line });
        });

        return { name: 'Счётчики', blocks: blocks };
    }

    function metersToWord(result, hyd) {
        Docx.save([metersDoc(result, hyd)], '', fileName().replace('.xlsx', ' — счётчики.docx'));
    }

    function pumpsToWord(result, hyd) {
        Docx.save([HydPumps.sheetOf(result, hyd)], '', fileName().replace('.xlsx', ' — насосы.docx'));
    }

    /*
        Лист «Квартиры по этажам»: сколько в каждом стояке студий, одно-, двух-, трёх-, четырёх- и пятикомнатных
        квартир, с итогами по зонам (насосным установкам) и по зданию; ниже по каждой зоне — раскладка по этажам
        (какие квартиры на каком этаже каждого стояка) и итоги этажа по типам. Квартира — выход этажного узла
        стояка, число комнат — поле выхода («Комнат»).
    */
    var ROOM_COLS = ['СТ', '1К', '2К', '3К', '4К', '5К+'];

    function roomIndex(rooms) { return Math.max(0, Math.min(5, rooms)); }
    function roomCode(rooms) { return rooms === 0 ? 'СТ' : (rooms >= 5 ? '5К+' : rooms + 'К'); }

    function aptSheet(result, hyd) {
        var ex = HydModel.expand(hyd);
        if (!ex.risers.length) return null;

        var zoneOfRiser = {};
        result.net.segs.forEach(function (g) {
            if (g.kind === 'riser' && g.meta && g.meta.riser && zoneOfRiser[g.meta.riser] === undefined) zoneOfRiser[g.meta.riser] = g.sys;
        });
        var sysName = {};
        var sysOrder = [];
        result.systems.forEach(function (s) { sysName[s.id] = s.name; sysOrder.push(s.id); });

        var zones = [];
        var byZone = {};

        ex.risers.forEach(function (entry) {
            var sid = zoneOfRiser[entry.node.id];
            var key = sid === undefined ? '' : sid;
            if (!byZone[key]) {
                byZone[key] = { key: key, label: sysName[key] || 'Без насосной установки', risers: [] };
                zones.push(byZone[key]);
            }

            var rec = { name: entry.node.name || entry.markC, node: entry.node, counts: [0, 0, 0, 0, 0, 0], total: 0, people: 0, floors: {} };
            entry.floors.forEach(function (fl) {
                var codes = [];
                fl.collectors.forEach(function (c) {
                    c.outlets.forEach(function (o) {
                        var rooms = o.outlet.rooms;
                        rec.counts[roomIndex(rooms)]++;
                        rec.total++;
                        rec.people += o.people;
                        codes.push(roomCode(rooms));
                    });
                });
                rec.floors[fl.f] = codes;
            });
            byZone[key].risers.push(rec);
        });

        zones.sort(function (a, b) {
            var ia = sysOrder.indexOf(a.key);
            var ib = sysOrder.indexOf(b.key);
            return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
        });

        var blocks = [{ kind: 'title', text: 'Квартиры по стоякам и зонам' }];
        var rows = [];
        var bold = [];
        var all = [0, 0, 0, 0, 0, 0];
        var allTotal = 0;
        var allPeople = 0;
        var sum = function (a, b) { return a.map(function (x, i) { return x + b[i]; }); };

        zones.forEach(function (z) {
            var zc = [0, 0, 0, 0, 0, 0];
            var zt = 0;
            var zp = 0;

            z.risers.forEach(function (r) {
                rows.push([z.label, r.name, r.node.floorFrom + '–' + r.node.floorTo].concat(r.counts, [r.total, r.people]));
                zc = sum(zc, r.counts);
                zt += r.total;
                zp += r.people;
            });

            bold.push(rows.length);
            rows.push(['Итого: ' + z.label, '', ''].concat(zc, [zt, zp]));
            all = sum(all, zc);
            allTotal += zt;
            allPeople += zp;
            z.counts = zc;
            z.total = zt;
        });

        rows.push(['Итого по зданию', '', ''].concat(all, [allTotal, allPeople]));

        blocks.push({
            kind: 'table',
            head: ['Зона', 'Стояк', 'Этажи'].concat(ROOM_COLS, ['Всего кв.', 'Жители']),
            widths: [22, 16, 10, 8, 8, 8, 8, 8, 8, 14, 12],
            digits: 0,
            rows: rows,
            bold: bold,
            total: rows.length - 1
        });
        blocks.push({ kind: 'note', text: 'СТ — студия, число перед «К» — число комнат. Квартира — выход этажного узла стояка (поле «Комнат» выхода); '
            + 'жителей — по таблице «Люди в квартире» опросника или числу людей, заданному у выхода.' });

        // раскладка по этажам — по зонам
        zones.forEach(function (z) {
            var from = Infinity;
            var to = 0;
            z.risers.forEach(function (r) { from = Math.min(from, r.node.floorFrom); to = Math.max(to, r.node.floorTo); });

            var frows = [];
            var tc = [0, 0, 0, 0, 0, 0];

            for (var f = from; f <= to; f++) {
                var counts = [0, 0, 0, 0, 0, 0];
                var cells = z.risers.map(function (r) {
                    var codes = r.floors[f] || [];
                    codes.forEach(function (c) { counts[ROOM_COLS.indexOf(c)]++; });
                    return codes.join(', ');
                });
                var n = counts.reduce(function (a, b) { return a + b; }, 0);
                if (!n) continue;
                tc = sum(tc, counts);
                frows.push([f].concat(cells, counts, [n]));
            }

            var totals = ['Итого'].concat(z.risers.map(function (r) { return r.total; }), tc, [z.total]);
            frows.push(totals);

            blocks.push({ kind: 'title', text: z.label + ' — квартиры по этажам' });
            blocks.push({
                kind: 'table',
                head: ['Этаж'].concat(z.risers.map(function (r) { return r.name; }), ROOM_COLS, ['Всего']),
                widths: [10].concat(z.risers.map(function () { return 16; }), ROOM_COLS.map(function () { return 8; }), [10]),
                digits: 0,
                rows: frows,
                total: frows.length - 1
            });
        });

        return { name: 'Квартиры по этажам', blocks: blocks };
    }

    function sheets(result, hyd) {
        var list = [headSheet(result, hyd), rowsSheet(result), metersSheet(result, hyd)];
        if (HydPumps.rows(result, hyd).length) list.push(HydPumps.sheetOf(result, hyd));
        var apts = aptSheet(result, hyd);
        if (apts) list.push(apts);
        list.push(inputSheet(result, hyd));
        return list;
    }

    function toExcel(result, hyd) {
        Xlsx.save(sheets(result, hyd), fileName());
    }

    return { sheets: sheets, aptSheet: aptSheet, toExcel: toExcel, meterRows: meterRows, aptMeters: aptMeters, metersToWord: metersToWord, pumpsToWord: pumpsToWord, metersDoc: metersDoc };
})();
