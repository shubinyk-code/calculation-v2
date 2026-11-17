/*
    Задание от ВК для ЭЛ и СС — оборудование раздела ВК, которому нужно электропитание (ЭЛ) и/или
    диспетчеризация (СС). Форма — бланк бюро «Задание от ВК для ЭЛ и СС» (лист «Задание», рядом
    «Пример заполнения» и «Данные»), он зашит в elss-template.js и заполняется как есть: стили,
    шапка, ширины колонок остаются от бланка.

    Что берётся из расчёта само:
        насосные станции   по зонам: Q и H требуемые, число рабочих/резервных, мощность и марка — из
                           подобранного каталожного листа (вкладка «Насосы»);
        водомерные узлы    основной на вводе и секционные: марка, DN, импульсный выход;
        квартирные счётчики  число по зонам, отдельно ХВС и ГВС;
        датчики давления   на каждом вводе и до/после насосов.
    Всё остальное (воронки с обогревом, дренажные насосы, полотенцесушители, КНС, электроприводы
    арматуры …) добавляется строками на вкладке; помещения и примечания дописываются у любой строки.
*/

var HydElss = (function () {
    'use strict';

    var NS_STR = function (v) { return Zip.xml(v); };
    var XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    /* Категории — как на листе «Данные» бланка; у каждой — диспетчеризация и протокол по умолчанию. */
    var CATEGORIES = [
        { name: 'Насосная станция', dispatch: 'Да', protocol: 'RS-485' },
        { name: 'Дренажный насос в Н.ст.', dispatch: 'Да', protocol: 'RS-485' },
        { name: 'Дренажный насос в ИТП', dispatch: 'Да', protocol: 'RS-485' },
        { name: 'Дренажный насос', dispatch: 'Да', protocol: 'RS-485' },
        { name: 'Дренажный насос для венткамеры', dispatch: 'Да', protocol: 'RS-485' },
        { name: 'Напорная установка отвода сточной воды', dispatch: 'Нет', protocol: '-' },
        { name: 'КНС', dispatch: 'Да', protocol: 'RS-485' },
        { name: 'Воронка с электрообогревом', dispatch: 'Нет', protocol: '-' },
        { name: 'Полотенцесушитель электрический', dispatch: 'Нет', protocol: '-' },
        { name: 'Водонагреватель', dispatch: 'Нет', protocol: '-' },
        { name: 'Счетчик основной на вводе', dispatch: 'Да', protocol: 'Импульсный выход' },
        { name: 'Счетчик у потребителя', dispatch: 'Да', protocol: 'Импульсный выход' },
        { name: 'Преобразователь давления (датчики давления)', dispatch: 'Да', protocol: 'RS-485' },
        { name: 'Датчик протечки', dispatch: 'Да', protocol: 'RS-485' },
        { name: 'Розетки для подключения приборов', dispatch: 'Нет', protocol: '-' },
        { name: 'Электропривод запорной арматуры', dispatch: 'Да', protocol: 'RS-485' }
    ];

    var PROTOCOLS = ['Импульсный выход', 'RS-485', 'Ethernet', '-'];
    var ACTUATOR_CAT = 'Электропривод запорной арматуры';

    /*
        Электроприводы ADL серии SQ 05.2–14.2 (каталог «Сервоприводы для трубопроводной арматуры»,
        март 2025, неполнооборотные): мощность мотора, кВт, и номинальный ток, А, при 380 и 220 В —
        по группам времени поворота на 90°; * — стандартное время срабатывания.
    */
    var ACTUATORS = [
        { size: 'SQ 05.2', torque: '50–150', variants: [
            { time: '4 / 5,6', kw: 0.06, i380: 0.60, i220: 1.70 }, { time: '8* / 11', kw: 0.04, i380: 0.40, i220: 1.10 },
            { time: '16 / 22', kw: 0.02, i380: 0.40, i220: 1.00 }, { time: '32', kw: 0.01, i380: 0.30, i220: 1.00 }] },
        { size: 'SQ 07.2', torque: '100–300', variants: [
            { time: '4 / 5,6', kw: 0.12, i380: 0.70, i220: 1.80 }, { time: '8* / 11', kw: 0.06, i380: 0.60, i220: 1.80 },
            { time: '16 / 22', kw: 0.03, i380: 0.40, i220: 1.10 }, { time: '32', kw: 0.01, i380: 0.30, i220: 1.00 }] },
        { size: 'SQ 10.2', torque: '200–600', variants: [
            { time: '8 / 11*', kw: 0.10, i380: 0.80, i220: 1.90 }, { time: '16 / 22', kw: 0.06, i380: 0.60, i220: 1.60 },
            { time: '32 / 45', kw: 0.04, i380: 0.50, i220: 1.10 }, { time: '63', kw: 0.02, i380: 0.30, i220: 1.00 }] },
        { size: 'SQ 12.2', torque: '400–1200', variants: [
            { time: '16 / 22*', kw: 0.10, i380: 0.80, i220: 1.90 }, { time: '32 / 45', kw: 0.06, i380: 0.60, i220: 1.60 },
            { time: '63', kw: 0.04, i380: 0.50, i220: 1.10 }] },
        { size: 'SQ 14.2', torque: '800–2400', variants: [
            { time: '24', kw: 0.19, i380: 1.10, i220: 2.00 }, { time: '36 / 48*', kw: 0.10, i380: 0.80, i220: 1.90 },
            { time: '72 / 100', kw: 0.06, i380: 0.60, i220: 1.60 }] }
    ];

    function actuator(size, time) {
        var a = ACTUATORS.filter(function (x) { return x.size === size; })[0];
        if (!a) return null;
        var v = a.variants.filter(function (x) { return x.time === time; })[0] || a.variants[0];
        return { a: a, v: v };
    }

    function actuatorText(size, time, volt) {
        var f = actuator(size, time);
        if (!f) return '';
        var i = volt === 220 ? f.v.i220 : f.v.i380;
        return 'Неполнооборотный электропривод ADL ' + f.a.size + ' (крутящий момент ' + f.a.torque + ' Н·м, время поворота на 90° – ' + f.v.time.replace(/\*/g, '') + ' с), IP68, с концевыми и моментными выключателями, '
            + 'питание ' + (volt === 220 ? '1~220' : '3~380') + ' В, Iном = ' + String(i).replace('.', ',') + ' А, мощность мотора ' + String(f.v.kw).replace('.', ',') + ' кВт. '
            + 'Сигналы: положение «открыто/закрыто», авария привода – в диспетчеризацию.';
    }

    function catDefaults(name) {
        return CATEGORIES.filter(function (c) { return c.name === name; })[0] || { dispatch: 'Нет', protocol: '-' };
    }

    function num(x, d) { return Format.num(x, d); }
    function round(x, d) { var k = Math.pow(10, d); return Math.round(x * k) / k; }

    /* Число рабочих и резервных у насосной: из подобранной строки («2+1»), иначе из узла схемы. */
    function counts(node, sel) {
        var m = sel && sel.count ? /^\s*(\d+)\s*(?:\+\s*(\d+))?/.exec(String(sel.count)) : null;
        if (m) return { work: +m[1], reserve: m[2] ? +m[2] : 0 };
        return { work: node && node.work > 0 ? node.work : 1, reserve: node && node.reserve > 0 ? node.reserve : 0 };
    }

    /* --- строки задания ------------------------------------------------------------- */

    /*
        Строки в порядке бланка. У каждой: key, auto, cat, title (графа «категория»), name (наименование),
        desc, work, reserve, kw, volt, dispatch, protocol, room, note, skip и список miss — чего ещё не
        хватает (показывается жёлтым на вкладке). Правки пользователя поверх автоматических — hyd.elss.auto[key].
    */
    function items(project, result, hyd) {
        var e = hyd.elss || HydModel.defaultElss();
        var s = hyd.survey;
        var out = [];

        function add(it) {
            var ov = e.auto[it.key] || {};
            var d = catDefaults(it.cat);
            var row = {
                key: it.key, auto: true, cat: it.cat, title: it.title, name: ov.name !== undefined && ov.name !== '' ? ov.name : it.name, desc: it.desc,
                work: it.work, reserve: it.reserve,
                kw: ov.kw !== undefined && ov.kw !== null ? ov.kw : it.kw,
                volt: ov.volt !== undefined && ov.volt !== null ? ov.volt : it.volt,
                dispatch: ov.dispatch || it.dispatch || d.dispatch, protocol: ov.protocol || it.protocol || d.protocol,
                room: ov.room || '', note: ov.note || it.note || '', skip: !!ov.skip, miss: []
            };
            if (!row.room) row.miss.push('помещение');
            if (it.needKw && !(row.kw > 0)) row.miss.push('мощность');
            out.push(row);
        }

        if (result && result.input) {
            // насосные станции
            HydPumps.rows(result, hyd).forEach(function (r) {
                var sys = r.sys;
                var sel = r.sel;
                var c = counts(sys.node, sel);
                var zone = HydPumps.zoneOf(sys.name);
                var title = 'Насосная станция водоснабжения ' + (zone !== null ? zone + ' зоны' : sys.name);
                var kw = sel && sel.power > 0 ? sel.power : null;
                var res = [];

                res.push('Модульная насосная установка повышения давления с частотным регулированием каждого насоса.');
                if (sel && sel.name) res.push(sel.name);
                res.push('Прибор управления, виброопоры, мембранный бак в комплекте.');
                res.push('Q=' + num(sys.pump.q, 3) + ' л/с');
                res.push('Н=' + num(sys.pump.hp, 2) + ' м');
                res.push('U=3~380V');
                res.push('N=' + (kw ? num(kw, 2) + ' кВт' : '[мощность — из каталожного листа]') + '  (' + c.work + ' рабоч.' + (c.reserve ? ' + ' + c.reserve + ' резервн.' : '') + ')    В проектной документации марку насоса не указывать');

                add({
                    key: 'pump:' + sys.id, cat: 'Насосная станция', title: title, name: sel && sel.name ? sel.name : '',
                    desc: res.join('\n'), work: c.work, reserve: c.reserve, kw: kw, volt: 380, needKw: true,
                    note: sel && sel.sheet ? 'Каталожный лист: ' + sel.sheet : ''
                });
            });

            // водомерные узлы на схеме
            result.net.segs.forEach(function (sg) {
                if (sg.dev !== 'meter' || !sg.res || !sg.res.meter || !sg.res.meter.pick || !sg.res.meter.pick.c) return;
                var c = sg.res.meter.pick.c;
                var node = HydModel.nodeById(hyd, sg.node);
                var main = sg.meter === 'main';
                var where = main ? 'Основной водомерный узел на вводе в здание' : 'Водомерный узел' + (node && node.name ? ' «' + node.name + '»' : '');
                var pulse = s.meter.pulse;

                add({
                    key: 'meter:' + sg.node, cat: 'Счетчик основной на вводе', title: (main ? 'Счётчик основной на вводе' : 'Счётчик водомерного узла') + (node && node.name && !main ? ' ' + node.name : ''),
                    name: c.markFull + ' (' + c.kindName + ', DN' + c.dn + ')',
                    desc: where + (sg.net === 'h' ? ' ГВС' : '') + '. Счётчик ' + c.markFull + (pulse ? ' с импульсным выходом' : '') + (pulse ? '; импульсный выход заводится на вычислитель/модем в систему диспетчеризации.' : '.'),
                    work: 1, reserve: 0, kw: null, volt: null, protocol: pulse ? 'Импульсный выход' : 'RS-485'
                });
            });

            // квартирные счётчики: по зонам, отдельно холодная и горячая вода
            if (s.apartmentMeter) {
                result.systems.forEach(function (sys) {
                    [['c', 'холодной'], ['h', 'горячей']].forEach(function (x) {
                        var list = result.net.segs.filter(function (sg) { return sg.meter === 'apt' && sg.net === x[0] && sg.sys === sys.id && sg.res && sg.res.meter && sg.res.meter.pick && sg.res.meter.pick.c; });
                        if (!list.length) return;
                        var c = list[0].res.meter.pick.c;
                        var marks = {};
                        list.forEach(function (sg) { marks[sg.res.meter.pick.c.markFull] = true; });

                        add({
                            key: 'apt:' + sys.id + ':' + x[0], cat: 'Счетчик у потребителя', title: 'Счётчики жилой части — ' + sys.name,
                            name: Object.keys(marks).join(', ') + ' (DN' + c.dn + ')', desc: 'Счётчик ' + x[1] + ' воды' + (s.meter.pulse ? ' с импульсным выходом' : '') + ', поквартирный учёт.',
                            work: list.length, reserve: 0, kw: null, volt: null, protocol: s.meter.pulse ? 'Импульсный выход' : 'RS-485'
                        });
                    });
                });
            }

            // датчики давления: на каждом вводе за первой стенкой и до/после насосов
            var inputs = hyd.canvas.nodes.filter(function (n) { return n.kind === 'input'; }).length;
            var pumped = result.systems.filter(function (x) { return x.pump && x.pump.pumped; }).length;
            var press = inputs + 2 * pumped;
            if (press > 0) {
                add({
                    key: 'press', cat: 'Преобразователь давления (датчики давления)', title: 'Преобразователь давления (датчики давления)', name: '',
                    desc: 'На вводе водопровода в здание на каждой трубе за первой стенкой' + (pumped ? ', а также до и после насосов' : '') + ' установить преобразователи давления (датчики давления).',
                    work: press, reserve: 0, kw: null, volt: null
                });
            }
        }

        // строки, добавленные вручную
        e.rows.forEach(function (r, i) {
            var d = catDefaults(r.cat);
            var row = {
                key: 'row:' + i, auto: false, index: i, cat: r.cat, title: r.cat, name: r.name, desc: r.desc, work: r.work, reserve: r.reserve,
                kw: r.kw, volt: r.volt, dispatch: r.dispatch || d.dispatch, protocol: r.protocol || d.protocol, room: r.room, note: r.note, skip: !!r.skip, miss: []
            };
            if (!row.room) row.miss.push('помещение');
            out.push(row);
        });

        return out;
    }

    /* --- Excel по бланку -------------------------------------------------------------- */

    function serialText(date) {
        var two = function (n) { return (n < 10 ? '0' : '') + n; };
        return two(date.getDate()) + '.' + two(date.getMonth() + 1) + '.' + date.getFullYear();
    }

    function xmlText(v) { return '<is><t xml:space="preserve">' + NS_STR(v) + '</t></is>'; }

    function setCell(row, c, spec) {
        var re = new RegExp('<c r="' + c + '\\d+"([^>]*?)(?:/>|>.*?</c>)', 's');
        var m = re.exec(row);
        if (!m) throw new Error('в строке бланка нет клетки ' + c);
        var style = /s="(\d+)"/.exec(m[1]);
        var ref = c + /<row r="(\d+)"/.exec(row)[1];
        var st = style ? ' s="' + style[1] + '"' : '';
        var cell;

        if (spec === null || spec === undefined || spec === '') cell = '<c r="' + ref + '"' + st + '/>';
        else if (typeof spec === 'string') cell = '<c r="' + ref + '"' + st + ' t="inlineStr">' + xmlText(spec) + '</c>';
        else if (typeof spec === 'number') cell = '<c r="' + ref + '"' + st + '><v>' + spec + '</v></c>';
        else cell = '<c r="' + ref + '"' + st + '><f>' + NS_STR(spec.f) + '</f><v>' + spec.v + '</v></c>';

        return row.replace(re, function () { return cell; });
    }

    function cloneRow(xml, n) {
        var r = xml.replace(/(<row r=")\d+"/, '$1' + n + '"').replace(/(<c r="[A-Z]+)\d+"/g, '$1' + n + '"');
        return r.replace(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>.*?<\/c>)/gs, function (all, ref, attrs) {
            var st = /s="(\d+)"/.exec(attrs);
            return '<c r="' + ref + '"' + (st ? ' s="' + st[1] + '"' : '') + '/>';
        });
    }

    /* Высота строки по тексту описания: колонка G ≈ 100 знаков в строку. */
    function heightOf(it) {
        var lines = 0;
        String(it.desc || '').split('\n').forEach(function (t) { lines += Math.max(1, Math.ceil(t.length / 92)); });
        var other = Math.max(1, Math.ceil(String(it.note || '').length / 36), Math.ceil(String(it.title || '').length / 20), Math.ceil(String(it.name || '').length / 24));
        return Math.max(40, Math.max(lines, other) * 19.5 + 8);
    }

    /* mode: 'all' — всё; 'el' — только то, что с нагрузкой; 'ss' — только с диспетчеризацией. */
    function selected(list, mode) {
        return list.filter(function (it) {
            if (it.skip) return false;
            if (mode === 'ss') return it.dispatch === 'Да';
            if (mode === 'el') return it.kw > 0 || it.volt > 0 || it.cat === 'Насосная станция';
            return true;
        });
    }

    function build(project, result, hyd, mode) {
        var e = hyd.elss || HydModel.defaultElss();
        var list = selected(items(project, result, hyd), mode || 'all');
        if (!list.length) return Promise.reject(new Error('в задании нет ни одной строки: добавьте оборудование на вкладке'));

        var obj = project.object || {};
        var desc = e.desc || ((hyd.survey.objectName || obj.name || project.name || '') + (obj.address ? ', ' + obj.address : ''));
        var issued = e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? new Date(e.date + 'T00:00:00') : new Date();

        return JSZip.loadAsync(ELSS_TEMPLATE_BASE64, { base64: true }).then(function (zip) {
            return zip.file('xl/worksheets/sheet1.xml').async('string').then(function (sheet) {
                var head = sheet.slice(0, sheet.indexOf('<sheetData>') + '<sheetData>'.length);
                var tailAt = sheet.indexOf('</sheetData>');
                var body = sheet.slice(sheet.indexOf('<sheetData>') + '<sheetData>'.length, tailAt);
                var tail = sheet.slice(tailAt);

                var proto = {};
                body.replace(/<row r="(\d+)"[^>]*?(?:\/>|>.*?<\/row>)/gs, function (xml, n) { proto[n] = xml; return xml; });

                var rows = [];
                for (var r = 1; r <= 12; r++) if (proto[r]) rows.push(proto[r]);
                var set = function (n, c, spec) {
                    var i = rows.findIndex(function (x) { return x.indexOf('<row r="' + n + '"') === 0; });
                    rows[i] = setCell(rows[i], c, spec);
                };

                set(3, 'B', desc);
                set(4, 'H', e.cipher || '');
                set(5, 'H', e.stage || 'П');
                set(6, 'H', serialText(issued));
                set(7, 'H', e.revision || 'Р00');
                set(5, 'O', e.author || '');
                set(6, 'O', e.issuedBy || '');
                set(7, 'O', e.acceptedBy || '');

                // строки оборудования — по образцу первой строки бланка, но без стиля гиперссылки в «Примечании»
                // (заливки «добавленная/изменённая/удалённая позиция» не ставятся: задание выдаётся с нуля)
                var row = 13;
                list.forEach(function (it, i) {
                    var x = cloneRow(proto[13], row).replace('<c r="O' + row + '" s="41"', '<c r="O' + row + '" s="40"');
                    var total = (it.work || 0) + (it.reserve || 0);
                    x = setCell(x, 'B', i + 1);
                    x = setCell(x, 'C', '');
                    x = setCell(x, 'D', it.room);
                    x = setCell(x, 'E', it.title);
                    x = setCell(x, 'F', it.name);
                    x = setCell(x, 'G', it.desc);
                    x = setCell(x, 'H', it.work || 0);
                    x = setCell(x, 'I', it.reserve || 0);
                    x = setCell(x, 'J', { f: 'H' + row + '+I' + row, v: total });
                    x = setCell(x, 'K', it.kw > 0 ? round(it.kw, 3) : '-');
                    x = setCell(x, 'L', it.volt > 0 ? it.volt : '-');
                    x = setCell(x, 'M', it.dispatch || 'Нет');
                    x = setCell(x, 'N', it.protocol || '-');
                    x = setCell(x, 'O', it.note);
                    x = setCell(x, 'P', '-');
                    x = setCell(x, 'Q', '-');
                    x = x.replace(/ht="[\d.]+"/, 'ht="' + round(heightOf(it), 1) + '"');
                    rows.push(x);
                    row++;
                });

                var last = row - 1;
                var merges = [];
                (tail.match(/<mergeCell ref="[^"]+"\/>/g) || []).forEach(function (m) {
                    var ref = /ref="([A-Z]+)(\d+)/.exec(m);
                    if (ref && +ref[2] <= 12) merges.push(m);
                });

                tail = tail.replace(/<mergeCells.*?<\/mergeCells>/s, '<mergeCells count="' + merges.length + '">' + merges.join('') + '</mergeCells>')
                    .replace(/<hyperlinks>.*?<\/hyperlinks>/s, '');
                head = head.replace(/<dimension ref="[^"]+"/, '<dimension ref="B1:S' + last + '"')
                    .replace(/<sheetView [^>]*>.*?<\/sheetView>/s, '<sheetView tabSelected="1" topLeftCell="B1" zoomScale="55" zoomScaleNormal="55" workbookViewId="0"><selection activeCell="B13" sqref="B13"/></sheetView>');

                // колонка «Протокол» шире, чтобы «Импульсный выход» не рвался посередине слова
                head = head.replace('<col min="14" max="14" width="10.7109375"', '<col min="14" max="14" width="17"');

                zip.file('xl/worksheets/sheet1.xml', head + rows.join('') + tail);

                var fixes = [zip.file('xl/workbook.xml').async('string').then(function (x) {
                    zip.file('xl/workbook.xml', x.replace('<calcPr calcId="191029"/>', '<calcPr calcId="191029" fullCalcOnLoad="1"/>'));
                }), zip.file('[Content_Types].xml').async('string').then(function (x) {
                    zip.file('[Content_Types].xml', x.replace(/<Override PartName="\/xl\/calcChain.xml"[^>]*\/>/, ''));
                }), zip.file('xl/_rels/workbook.xml.rels').async('string').then(function (x) {
                    zip.file('xl/_rels/workbook.xml.rels', x.replace(/<Relationship Id="[^"]*"[^>]*calcChain[^>]*\/>/, ''));
                })];

                zip.remove('xl/calcChain.xml');

                return Promise.all(fixes).then(function () { return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }); });
            });
        });
    }

    function fileName(project, hyd, mode) {
        var base = (hyd.survey.objectName || (project.object && project.object.name) || 'Объект').replace(/[\\\/:*?"<>|]/g, '-');
        var rev = ((hyd.elss && hyd.elss.revision) || 'Р00').replace(/[\\\/:*?"<>|]/g, '-');
        return 'Задание от ВК для ' + (mode === 'ss' ? 'СС' : mode === 'el' ? 'ЭЛ' : 'ЭЛ и СС') + '_' + base + '_' + rev + '.xlsx';
    }

    function save(project, result, hyd, mode) {
        return build(project, result, hyd, mode).then(function (bytes) {
            Zip.save(bytes, fileName(project, hyd, mode), XLSX_TYPE);
            return bytes;
        });
    }

    return {
        CATEGORIES: CATEGORIES, PROTOCOLS: PROTOCOLS, ACTUATORS: ACTUATORS, ACTUATOR_CAT: ACTUATOR_CAT,
        actuator: actuator, actuatorText: actuatorText, catDefaults: catDefaults,
        items: items, selected: selected, build: build, save: save, fileName: fileName
    };
})();
