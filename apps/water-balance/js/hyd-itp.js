/*
    Задание в ИТП: «Задание на разработку блока ГВС теплового пункта» по бланку бюро.

    Всё берётся из расчёта гидравлики: на каждую ИТП (зону) — отметки нижнего и верхнего приборов
    ГВС, напор ХВС на вводе в ИТП, расходы Т3 (жильё, встройка, общий: секундный из СП 30 и
    максимальный часовой по формуле (5.x) через Demand), напор на выходе (напор на вводе минус
    потери в ИТП), циркуляция Т4 (доля от секундного расхода Т3, потери по умолчанию как в
    образце: жильё 10 м, встройка 5 м), диаметры труб по скорости, тепловая нагрузка в Гкал/ч и кВт,
    итоги по зданию. Параметры, которых в расчёте нет (шифр, стадия, фамилии, температуры, доля
    циркуляции), вводятся на вкладке «Задание в ИТП» (hyd.itp).

    Бланк берётся целиком: стили, комментарии-подсказки и ширины колонок остаются как в оригинале
    (itp-template.js); пересобираются только строки блоков зон — их столько, сколько зон на схеме,
    как и велит комментарий бланка («блок зоны копируется через строчку»). Формулы тепла остаются
    формулами и пересчитываются при открытии в Excel.
*/

var HydItp = (function () {
    'use strict';

    var NS_STR = function (v) { return Zip.xml(v); };

    function round(x, d) { var k = Math.pow(10, d); return Math.round(x * k) / k; }

    /* --- расчёт данных задания --------------------------------------------------- */

    function zoneNoOf(name, fallback) {
        var m = /(\d+)\s*зон/i.exec(name || '');
        return m ? Number(m[1]) : fallback;
    }

    /* Подъём по parent до сегмента id: лежит ли сегмент в поддереве. */
    function under(byId, seg, id) {
        for (var s = seg, n = 0; s && n < 500; s = byId[s.parent], n++) if (s.id === id) return true;
        return false;
    }

    function demandGroups(groups) {
        return groups.filter(function (g) { return !g.noHot && g.U > 0; }).map(function (g) {
            return { name: g.kind, norm: g.norm, users: g.U, fixtures: g.N > 0 ? g.N : g.U, fixturesHot: g.Nh > 0 ? g.Nh : g.U, q0Sewer: 1.6 };
        });
    }

    /* Секундный и часовой расход горячей воды набора групп. */
    function flowOf(groups, node, fixedP) {
        var live = groups.filter(function (g) { return !g.noHot && g.U > 0; });
        if (!live.length) return null;
        var sec = HydFlow.aggregate(live, 'hot', { node: node, fixedP: fixedP });
        var d = Demand.combine('ГВС', demandGroups(live), node).hot;
        return { sec: round(sec.q, 3), hour: round(d ? d.qhr : 0, 3), avg: round(d ? d.qAvgHour : 0, 3), U: sec.U };
    }

    function sizeOf(matKey, q, vmax, nu) {
        if (!(q > 0)) return null;
        var pick = HydFlow.pickSize(matKey, q, vmax, nu);
        return pick.size ? { size: pick.size, ok: pick.ok } : null;
    }

    /* Подпись трубы по бланку: нержавейка и полимеры — Dн×d, ВГП — Ду×d. */
    function sizeText(pick, matKey) {
        if (!pick) return '';
        var s = pick.size;
        var wall = String(s.wall).replace('.', ',');
        var first = matKey === 'steel3262' ? s.dn : s.od;
        return first + 'х' + wall + (/^ss/.test(matKey) ? ' нерж' : '');
    }

    /*
        Данные по каждой ИТП и итоги по зданию. Возвращает
        { itps: [{ no, label, zone, low, high, headIn, res, bi, all, mat, matName, … }], total, inputs, warnings, p }.
    */
    function data(project, result, hyd) {
        var p = hyd.itp || HydModel.defaultItp();
        var s = hyd.survey;
        var node = project.alphaMode === 'node';
        var net = result.net;
        var out = { itps: [], groups: [], numbered: false, total: null, inputs: hyd.canvas.nodes.filter(function (n) { return n.kind === 'input'; }).length, warnings: [], p: p, hItp: s.hItp };

        var devs = net.segs.filter(function (g) { return g.kind === 'itpdev'; });
        if (!devs.length) return out;

        var pumps = result.systems.filter(function (x) { return x.kind === 'pump'; });
        var zoneOf = function (sysId) {
            var i = pumps.map(function (x) { return x.id; }).indexOf(sysId);
            return i < 0 ? 1 : zoneNoOf(pumps[i].name, i + 1);
        };

        devs.forEach(function (dev) {
            var itpNode = HydModel.nodeById(hyd, dev.node);
            var feed = net.byId[dev.parent];
            var zone = zoneOf(feed ? feed.sys : '');
            var groups = dev.groups || [];
            var fixedP = hyd.method === 'fixtures' ? HydFlow.aggregate(groups.filter(function (g) { return !g.noHot; }), 'hot', { node: node }).P : 0;

            var res = flowOf(groups.filter(function (g) { return g.kind !== 'buildin'; }), node, fixedP);
            var bi = flowOf(groups.filter(function (g) { return g.kind === 'buildin'; }), node, fixedP);
            var all = flowOf(groups, node, fixedP);

            var leaves = net.leaves.filter(function (lf) { return lf.net === 'h' && under(net.byId, net.byId[lf.seg], dev.id); });
            var elevs = leaves.map(function (lf) { return lf.elev; });

            // труба на выходе из ИТП: материал берём у первого участка за ИТП
            var next = net.segs.filter(function (g) { return g.parent === dev.id && g.res && g.res.size; })[0];
            var mat = next ? next.res.size.material : 'ss9941';

            var item = {
                itp: itpNode, name: itpNode ? itpNode.name : 'ИТП', zone: zone,
                low: elevs.length ? Math.min.apply(null, elevs) : null,
                high: elevs.length ? Math.max.apply(null, elevs) : null,
                headIn: dev.res && dev.res.hd ? round(dev.res.hd.inDyn, 2) : null,
                res: res, bi: bi, all: all, mat: mat, matName: HydData.material(mat).name, groups: groups
            };

            [['res', res], ['bi', bi], ['all', all]].forEach(function (pair) {
                var f = pair[1];
                if (!f) return;
                f.pipe = sizeOf(mat, f.sec, s.vmax.mains, s.nu.hot);
                f.pipeText = sizeText(f.pipe, mat);
                if (pair[0] !== 'all') {
                    f.circ = round(f.sec * p.circFactor, 3);
                    f.circPipe = sizeOf(mat, f.circ, p.vCirc, s.nu.hot);
                    f.circText = sizeText(f.circPipe, mat);
                }
            });

            out.itps.push(item);
        });

        out.itps.sort(function (a, b) { return a.zone - b.zone; });

        // марки систем по бланку: Т3.k при нескольких зонах; несколько ИТП в зоне — суффикс -n
        var zones = {};
        out.itps.forEach(function (it) { zones[it.zone] = (zones[it.zone] || 0) + 1; });
        var many = Object.keys(zones).length > 1;
        var seen = {};
        out.itps.forEach(function (it, i) {
            seen[it.zone] = (seen[it.zone] || 0) + 1;
            var suffix = zones[it.zone] > 1 ? '-' + seen[it.zone] : '';
            it.no = i + 1;
            it.m3 = (many ? 'Т3.' + it.zone : 'Т3') + suffix;
            it.m4 = (many ? 'Т4.' + it.zone : 'Т4') + suffix;
            it.b3 = it.zone + 'Т3' + suffix;
            it.b4 = it.zone + 'Т4' + suffix;
        });

        // итоги по зданию: расход свода всех групп ГВС
        var every = [];
        out.itps.forEach(function (it) { it.groups.forEach(function (g) { if (every.indexOf(g) < 0) every.push(g); }); });
        var fixedAll = hyd.method === 'fixtures' ? HydFlow.aggregate(every.filter(function (g) { return !g.noHot; }), 'hot', { node: node }).P : 0;
        var tot = flowOf(every, node, fixedAll);

        if (tot) {
            tot.circ = 0;
            out.itps.forEach(function (it) { [it.res, it.bi].forEach(function (f) { if (f) tot.circ += f.circ; }); });
            tot.circ = round(tot.circ, 3);
            out.total = tot;
        }

        groupItps(out, hyd, node);

        return out;
    }

    /*
        Разделение по ИТП. У ИТП на схеме может быть номер (поле «Отдельное задание»): ИТП с номером — свой
        расчёт и своё задание, ИТП без номера вместе составляют одну общую ИТП. Если номеров нет вовсе —
        одна группа без подписи (как раньше: всё задание на здание). Для группы считаются её собственные
        расходы (свод групп её потребителей) и циркуляция.
    */
    function groupItps(out, hyd, node) {
        var byNo = {};
        var order = [];

        out.itps.forEach(function (it) {
            var no = it.itp && it.itp.itpNo > 0 ? it.itp.itpNo : 0;
            if (!byNo[no]) { byNo[no] = { no: no, itps: [] }; order.push(no); }
            byNo[no].itps.push(it);
        });

        out.numbered = order.some(function (no) { return no > 0; });
        order.sort(function (a, b) { return a === 0 ? 1 : b === 0 ? -1 : a - b; });

        out.groups = order.map(function (no) {
            var g = byNo[no];
            g.label = !out.numbered ? '' : no > 0 ? 'ИТП ' + no : 'ИТП (общий)';

            if (!out.numbered) { g.total = out.total; return g; }

            var every = [];
            g.itps.forEach(function (it) { it.groups.forEach(function (x) { if (every.indexOf(x) < 0) every.push(x); }); });
            var fixed = hyd.method === 'fixtures' ? HydFlow.aggregate(every.filter(function (x) { return !x.noHot; }), 'hot', { node: node }).P : 0;
            var tot = flowOf(every, node, fixed);
            if (tot) {
                tot.circ = 0;
                g.itps.forEach(function (it) { [it.res, it.bi].forEach(function (f) { if (f) tot.circ += f.circ; }); });
                tot.circ = round(tot.circ, 3);
            }
            g.total = tot;
            return g;
        });
    }

    /* --- тепловая нагрузка (те же формулы, что в бланке) ------------------------- */

    function heat(hour, circ, p) {
        var gcal = hour * (p.tHot - p.tCold) / 1000 + circ * 3.6 * (p.tHot - p.tCirc) / 1000;
        return { gcal: gcal, kw: gcal * 1163 };
    }

    /* --- сборка листа ------------------------------------------------------------ */

    function col(i) { return 'ABCDEFGH'.charAt(i); }

    function serial(date) {
        return Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
    }

    function fmtElev(x) {
        if (x === null || x === undefined) return '';
        var sign = x < 0 ? '"-"' : '"+"';
        return sign + ' ' + Math.abs(x).toFixed(3).replace('.', ',') + ' м';
    }

    function xmlText(v) { return '<is><t xml:space="preserve">' + NS_STR(v) + '</t></is>'; }

    /* Клетка листа: остаётся стиль бланка, содержимое — число, текст или формула. */
    function setCell(row, c, spec) {
        var re = new RegExp('<c r="' + c + '\\d+"([^>]*?)(?:/>|>.*?</c>)', 's');
        var m = re.exec(row);
        if (!m) throw new Error('в строке бланка нет клетки ' + c);
        var style = /s="(\d+)"/.exec(m[1]);
        var ref = c + /<row r="(\d+)"/.exec(row)[1];
        var s = style ? ' s="' + style[1] + '"' : '';
        var cell;

        if (spec === null || spec === undefined || spec === '') cell = '<c r="' + ref + '"' + s + '/>';
        else if (typeof spec === 'string') cell = '<c r="' + ref + '"' + s + ' t="inlineStr">' + xmlText(spec) + '</c>';
        else if (typeof spec === 'number') cell = '<c r="' + ref + '"' + s + '><v>' + spec + '</v></c>';
        else cell = '<c r="' + ref + '"' + s + '><f>' + NS_STR(spec.f) + '</f><v>' + spec.v + '</v></c>';

        return row.replace(re, function () { return cell; });
    }

    /* Строка бланка с новым номером; blank — убрать значения, оставив стили. */
    function cloneRow(xml, n, blank) {
        var r = xml.replace(/(<row r=")\d+"/, '$1' + n + '"').replace(/(<c r="[A-Z]+)\d+"/g, '$1' + n + '"');
        if (blank) r = r.replace(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>.*?<\/c>)/gs, function (all, ref, attrs) {
            var st = /s="(\d+)"/.exec(attrs);
            return '<c r="' + ref + '"' + (st ? ' s="' + st[1] + '"' : '') + '/>';
        });
        return r;
    }

    /*
        Лист задания по одной группе ИТП (grp: { itps, total, label }). label пустой — ИТП общий (без номера),
        лист один на здание; иначе «ИТП 2», «ИТП (общий)» — отдельное задание этой ИТП. first — лист с
        подсказками бланка (комментарии привязаны к первому листу).
    */
    function makeSheet(sheet, grp, ctx, first) {
        var d = ctx.d, p = d.p, s = ctx.survey, hItp = s.hItp, T = ctx.T, C = ctx.C;
        var itps = grp.itps, total = grp.total;
        var head = sheet.slice(0, sheet.indexOf('<sheetData>') + '<sheetData>'.length);
        var tailAt = sheet.indexOf('</sheetData>');
        var body = sheet.slice(sheet.indexOf('<sheetData>') + '<sheetData>'.length, tailAt);
        var tail = sheet.slice(tailAt);

        var proto = {};
        body.replace(/<row r="(\d+)".*?<\/row>/gs, function (xml, n) { proto[n] = xml; return xml; });

        var rows = [];
        var merges = ['A1:H1', 'A2:B2', 'C2:H2', 'A3:B3', 'C3:E3', 'A4:B4', 'A5:B5', 'A6:B6', 'A7:H7', 'A8:H8', 'D9:E9', 'D10:E10', 'D11:E11', 'B12:H12', 'A15:H15', 'A16:E16'];

        // шапка 1–16
        var r;
        for (r = 1; r <= 16; r++) if (proto[r]) rows.push(proto[r]);
        var set = function (n, c, spec) { var i = rows.findIndex(function (x) { return x.indexOf('<row r="' + n + '"') === 0; }); rows[i] = setCell(rows[i], c, spec); };

        var objName = s.objectName || ctx.project.object && ctx.project.object.name || '';
        set(2, 'C', objName + (grp.label ? ' — ' + grp.label : ''));
        set(3, 'C', p.cipher);
        set(4, 'C', p.stage);
        set(5, 'C', serial(ctx.issued));
        set(6, 'C', p.revision);
        set(4, 'H', p.author);
        set(5, 'H', p.issuedBy);
        set(6, 'H', p.acceptedBy);
        set(10, 'D', p.tHot);
        set(11, 'D', p.tCirc);
        set(12, 'B', p.notes);

        // отметки и напор по зонам: по три строки на ИТП
        var K = itps.length;
        var row = 17;
        var inRow = {};

        itps.forEach(function (it, k) {
            var a = cloneRow(proto[17], row);
            var b = cloneRow(proto[18], row + 1);
            var c = cloneRow(proto[19], row + 2);
            a = setCell(a, 'D', fmtElev(it.low));
            a = setCell(a, 'F', ctx.manyZones || K > 1 ? it.zone + ' зона' : '1 зона');
            b = setCell(b, 'D', fmtElev(it.high));
            c = setCell(c, 'D', it.headIn === null ? '' : it.headIn);
            rows.push(a, b, c);
            merges.push('A' + row + ':B' + row, 'C' + row + ':C' + (row + 1), 'D' + row + ':E' + row, 'F' + row + ':F' + (row + 2),
                'A' + (row + 1) + ':B' + (row + 1), 'D' + (row + 1) + ':E' + (row + 1),
                'A' + (row + 2) + ':B' + (row + 2), 'D' + (row + 2) + ':E' + (row + 2));
            inRow[k] = row + 2;
            row += 3;
        });

        rows.push(cloneRow(proto[23], row));
        row++;
        var headerRow = row;
        rows.push(cloneRow(proto[24], row));
        row++;

        // блоки расчёта по зонам
        var circRefs = [];
        var body2 = [];
        var add = function (protoNo, cells) {
            var x = cloneRow(proto[protoNo], row, true);
            Object.keys(cells).forEach(function (c) { x = setCell(x, c, cells[c]); });
            body2.push(x);
            return row++;
        };

        itps.forEach(function (it, k) {
            var first = row;
            var hasBoth = !!(it.res && it.bi);
            var inCell = 'D' + inRow[k];
            var E = round((it.headIn || 0) - hItp, 2);
            var mat = it.matName;

            var part = function (f, m3, m4, label3, label4, protos, lossKey, zoneCell) {
                var r3 = row;
                var cells3 = { B: label3, C: f.hour, D: f.sec, E: { f: inCell + '-' + hItp, v: E }, G: f.pipeText };
                if (zoneCell) cells3.A = it.zone;
                add(protos[0], cells3);
                var r4 = row;
                var loss = p[lossKey];
                add(protos[1], { B: label4, C: { f: 'D' + r4 + '*3.6', v: round(f.circ * 3.6, 4) }, D: { f: 'D' + r3 + '*' + p.circFactor, v: f.circ }, F: { f: 'E' + r3 + '-' + loss, v: round(E - loss, 2) }, G: f.circText });
                var h = heat(f.hour, f.circ, p);
                add(protos[2], { B: 'Гкал', C: { f: 'C' + r3 + '*' + T + '/1000+D' + r4 + '*3.6*' + C + '/1000', v: round(h.gcal, 5) } });
                add(protos[3], { B: 'КВт', C: { f: '1.163*(C' + r3 + '*' + T + '+D' + r4 + '*3.6*' + C + ')', v: round(h.kw, 4) } });
                circRefs.push('D' + r4);
                return { r3: r3, r4: r4 };
            };

            var single = !hasBoth;
            var pr = single ? [37, 38, 39, 40] : [25, 26, 27, 28];
            var pb = single ? [37, 38, 39, 40] : [29, 30, 31, 32];
            var A = null;

            if (it.res) A = part(it.res, it.m3, it.m4, it.m3 + ' (жилье)', it.m4 + ' (жилье)', pr, 'circLossRes', true);
            var B = null;
            if (it.bi) B = part(it.bi, it.b3, it.b4, it.b3 + ' (встройка)', it.b4 + ' (встройка)', pb, 'circLossBuilt', !it.res);

            if (hasBoth) {
                var f = it.all;
                var h = heat(f.hour, it.res.circ + it.bi.circ, p);
                var rAll = add(33, { B: 'Т3 общая: жильё + встройка, ' + it.zone + ' зона', C: f.hour, D: f.sec, G: f.pipeText });
                add(34, {});
                var sumC = '(D' + B.r4 + '+D' + A.r4 + ')';
                add(35, { B: 'Гкал', C: { f: 'C' + rAll + '*' + T + '/1000+' + sumC + '*3.6*' + C + '/1000', v: round(h.gcal, 5) } });
                add(36, { B: 'КВт', C: { f: '(C' + rAll + '*' + T + '+' + sumC + '*3.6*' + C + ')*1.163', v: round(h.kw, 4) } });
            }

            var last = row - 1;
            merges.push('A' + first + ':A' + (first + 3));
            merges.push('H' + first + ':H' + last);
            // материал труб — в первой строке блока
            var idx = body2.length - (last - first + 1);
            body2[idx] = setCell(body2[idx], 'H', mat);
        });

        // итоги: по зданию, а у отдельной ИТП — по этой ИТП
        var band = cloneRow(proto[41], row);
        merges.push('B' + row + ':H' + row);
        row++;
        var circSum = circRefs.join('+');
        var scope = grp.label ? grp.label : 'в здание';

        var t42 = cloneRow(proto[42], row);
        if (grp.label) t42 = setCell(t42, 'B', 'Т3 -общая (' + scope + ')');
        t42 = setCell(t42, 'C', total ? total.hour : 0);
        t42 = setCell(t42, 'D', total ? total.sec : 0);
        var rT = row++;
        var t43 = cloneRow(proto[43], row);
        if (grp.label) t43 = setCell(t43, 'B', 'Т3ср -общая (' + scope + ')');
        t43 = setCell(t43, 'C', total ? total.avg : 0);
        var rA = row++;

        var hMax = heat(total ? total.hour : 0, total ? total.circ : 0, p);
        var hAvg = heat(total ? total.avg : 0, total ? total.circ : 0, p);
        var mk = function (protoNo, cellC) { var x = cloneRow(proto[protoNo], row); x = setCell(x, 'C', cellC); row++; return x; };
        var t44 = mk(44, { f: '(C' + rT + '*' + T + '+(' + circSum + ')*3.6*' + C + ')/1000', v: round(hMax.gcal, 5) });
        var t45 = mk(45, { f: '1.163*(C' + rT + '*' + T + '+(' + circSum + ')*3.6*' + C + ')', v: round(hMax.kw, 4) });
        var t46 = mk(46, { f: '(C' + rA + '*' + T + '+(' + circSum + ')*3.6*' + C + ')/1000', v: round(hAvg.gcal, 5) });
        var t47 = mk(47, { f: '1.163*(C' + rA + '*' + T + '+(' + circSum + ')*3.6*' + C + ')', v: round(hAvg.kw, 4) });

        // примечания
        var notes = ['Примечания:', ''];
        notes.push('1. Предусмотрено вводов хоз.-питьевого водопровода в здание: ' + d.inputs);
        notes.push('2. Предусмотреть установку узлов учета на приготовление горячей воды и на циркуляции горячего водоснабжения в помещении ИТП');
        if (grp.label) notes.push('3. Задание выдано на ' + grp.label + ' (всего ИТП в комплексе: ' + ctx.groupCount + '); нагрузка по комплексу в целом — на листе «Итого по комплексу».');
        if (p.notesExtra) notes.push(p.notesExtra);
        var rowN = cloneRow(proto[48], row);
        rowN = setCell(rowN, 'B', notes.join('\n'));
        var lines = notes.reduce(function (a, t) { return a + Math.max(1, Math.ceil(t.length / 95)); }, 0);
        rowN = rowN.replace(/ht="[\d.]+"/, 'ht="' + Math.max(97.5, lines * 15 + 8) + '"');
        merges.push('B' + row + ':H' + row);
        var lastRow = row;

        var sheetData = rows.join('') + body2.join('') + band + t42 + t43 + t44 + t45 + t46 + t47 + rowN;
        var mergeXml = '<mergeCells count="' + merges.length + '">' + merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>';

        head = head.replace(/<dimension ref="[^"]+"/, '<dimension ref="A1:H' + lastRow + '"')
            .replace(/<sheetView [^>]*>.*?<\/sheetView>/s, '<sheetView' + (first ? ' tabSelected="1"' : '') + ' workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView>');
        tail = tail.replace(/<mergeCells.*?<\/mergeCells>/s, mergeXml);

        // у дополнительных листов нет ни подсказок (комментарии привязаны к первому листу), ни настроек принтера
        if (!first) tail = tail.replace(/<legacyDrawing [^>]*\/>/, '').replace(/(<pageSetup [^>]*?) r:id="[^"]*"/, '$1');

        return { xml: head + sheetData + tail, headerRow: headerRow, heatMax: hMax, heatAvg: hAvg };
    }

    /* Лист «Итого по комплексу»: нагрузка по каждой ИТП и сумма. Стили — из бланка (шапка, ячейки, числа). */
    function summarySheet(d, results) {
        var p = d.p;
        var rows = [];
        var esc = function (t) { return NS_STR(t); };
        var str = function (ref, st, t) { return '<c r="' + ref + '" s="' + st + '" t="inlineStr"><is><t xml:space="preserve">' + esc(t) + '</t></is></c>'; };
        var numc = function (ref, st, v) { return '<c r="' + ref + '" s="7"><v>' + v + '</v></c>'; };
        var fml = function (ref, st, f, v) { return '<c r="' + ref + '" s="7"><f>' + f + '</f><v>' + v + '</v></c>'; };
        var cols = 'ABCDEFGHI';
        var heads = ['№', 'ИТП', 'Макс. часовой расход Т3, м³/ч', 'Секундный расход Т3, л/с', 'Циркуляция Т4, л/с', 'Нагрузка макс., Гкал/ч', 'Нагрузка макс., кВт', 'Нагрузка средняя, Гкал/ч', 'Нагрузка средняя, кВт'];

        rows.push('<row r="1" ht="21">' + str('A1', 18, 'Тепловая нагрузка на ГВС — итого по комплексу') + '</row>');
        rows.push('<row r="2" ht="18">' + str('A2', 39, 'Нагрузка на каждую ИТП (расход по вероятности её собственных потребителей) и по комплексу в целом; формулы тепла — как в заданиях на листах ИТП.') + '</row>');
        rows.push('<row r="3" ht="48">' + heads.map(function (t, i) { return str(cols.charAt(i) + '3', 29, t); }).join('') + '</row>');

        var r = 4;
        results.forEach(function (x, i) {
            var g = x.grp;
            var t = g.total || { hour: 0, sec: 0, avg: 0, circ: 0 };
            var vals = [t.hour, t.sec, t.circ, x.heatMax.gcal, x.heatMax.kw, x.heatAvg.gcal, x.heatAvg.kw];
            rows.push('<row r="' + r + '">' + str('A' + r, 39, String(i + 1)) + str('B' + r, 39, g.label || 'ИТП')
                + vals.map(function (v, k) { return numc(cols.charAt(k + 2) + r, 31, round(v, k < 3 ? 3 : 4)); }).join('') + '</row>');
            r++;
        });

        // комплекс в целом: расход — свод по вероятности всех потребителей ГВС (СП 30), а не сумма по ИТП;
        // циркуляция Т4 складывается
        if (d.total) {
            var hm = heat(d.total.hour, d.total.circ, p);
            var ha = heat(d.total.avg, d.total.circ, p);
            rows.push('<row r="' + r + '">' + str('A' + r, 18, '') + str('B' + r, 18, 'Итого по комплексу (свод по вероятности)')
                + [d.total.hour, d.total.sec, d.total.circ, hm.gcal, hm.kw, ha.gcal, ha.kw].map(function (v, k) { return numc(cols.charAt(k + 2) + r, 31, round(v, k < 3 ? 3 : 4)); }).join('') + '</row>');
            r++;
        }

        rows.push('<row r="' + r + '">' + str('A' + r, 39, 'Пояснение: нагрузки ИТП не суммируются — расход комплекса определяется сводом по вероятности всех потребителей ГВС (СП 30), '
            + 'так как пики разных ИТП не совпадают; циркуляция Т4 складывается.') + '</row>');

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            + '<dimension ref="A1:I' + r + '"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>'
            + '<cols><col min="1" max="1" width="5" customWidth="1"/><col min="2" max="2" width="46" customWidth="1"/><col min="3" max="9" width="17" customWidth="1"/></cols>'
            + '<sheetData>' + rows.join('') + '</sheetData>'
            + '<mergeCells count="2"><mergeCell ref="A1:I1"/><mergeCell ref="A2:I2"/></mergeCells>'
            + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape"/></worksheet>';
    }

    function build(project, result, hyd) {
        var d = data(project, result, hyd);
        if (!d.itps.length) return Promise.reject(new Error('на схеме нет ИТП: поставьте «ИТП» и соедините трубой на листах ХВС и ГВС'));

        var p = d.p;
        var s = hyd.survey;
        var today = new Date();
        var ctx = {
            d: d, project: project, survey: s, groupCount: d.groups.length,
            issued: p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? new Date(p.date + 'T00:00:00') : today,
            T: '($D$10-' + p.tCold + ')', C: '($D$10-$D$11)',
            manyZones: Object.keys(d.itps.reduce(function (a, it) { a[it.zone] = 1; return a; }, {})).length > 1
        };
        var multi = d.groups.length > 1;

        return JSZip.loadAsync(ITP_TEMPLATE_BASE64, { base64: true }).then(function (zip) {
            return zip.file('xl/worksheets/sheet1.xml').async('string').then(function (sheet) {
                var made = d.groups.map(function (g, i) {
                    var m = makeSheet(sheet, g, ctx, i === 0);
                    m.grp = g;
                    return m;
                });

                zip.file('xl/worksheets/sheet1.xml', made[0].xml);
                made.slice(1).forEach(function (m, i) { zip.file('xl/worksheets/sheet' + (i + 2) + '.xml', m.xml); });
                if (multi) zip.file('xl/worksheets/sheet' + (made.length + 1) + '.xml', summarySheet(d, made));

                var headerRow = made[0].headerRow;
                var names = multi ? d.groups.map(function (g) { return g.label; }).concat(['Итого по комплексу']) : ['Задание ИТП'];
                var count = names.length;

                // подсказки второй шапки переезжают вместе с ней
                var fixes = [zip.file('xl/comments1.xml').async('string').then(function (x) {
                    zip.file('xl/comments1.xml', x.replace(/ref="([A-Z])24"/g, 'ref="$1' + headerRow + '"'));
                }), zip.file('xl/drawings/vmlDrawing1.vml').async('string').then(function (x) {
                    zip.file('xl/drawings/vmlDrawing1.vml', x.replace(/<x:Row>23<\/x:Row>/g, '<x:Row>' + (headerRow - 1) + '</x:Row>'));
                }), zip.file('xl/workbook.xml').async('string').then(function (x) {
                    var sheets = names.map(function (n, i) {
                        return '<sheet name="' + NS_STR(n.slice(0, 31)) + '" sheetId="' + (i === 0 ? 4 : 10 + i) + '" r:id="' + (i === 0 ? 'rId1' : 'rId' + (20 + i)) + '"/>';
                    }).join('');
                    x = x.replace(/<mc:AlternateContent.*?<\/mc:AlternateContent>/s, '')
                        .replace('<calcPr calcId="191029"/>', '<calcPr calcId="191029" fullCalcOnLoad="1"/>')
                        .replace(/<sheets>.*?<\/sheets>/s, '<sheets>' + sheets + '</sheets>');
                    zip.file('xl/workbook.xml', x);
                }), zip.file('[Content_Types].xml').async('string').then(function (x) {
                    var over = '';
                    for (var i = 2; i <= count; i++) over += '<Override PartName="/xl/worksheets/sheet' + i + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
                    zip.file('[Content_Types].xml', x.replace(/<Override PartName="\/xl\/calcChain.xml"[^>]*\/>/, over));
                }), zip.file('xl/_rels/workbook.xml.rels').async('string').then(function (x) {
                    var rel = '';
                    for (var i = 1; i < count; i++) rel += '<Relationship Id="rId' + (20 + i) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
                    zip.file('xl/_rels/workbook.xml.rels', x.replace(/<Relationship Id="rId5"[^>]*calcChain[^>]*\/>/, rel));
                })];

                zip.remove('xl/calcChain.xml');

                return Promise.all(fixes).then(function () { return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }); });
            });
        });
    }

    function fileName(project, hyd) {
        var base = (hyd.survey.objectName || (project.object && project.object.name) || 'Объект').replace(/[\\\/:*?"<>|]/g, '-');
        var t = new Date();
        var two = function (n) { return (n < 10 ? '0' : '') + n; };
        return 'Задание ИТП ' + base + ' ' + two(t.getDate()) + '.' + two(t.getMonth() + 1) + '.' + t.getFullYear() + '.xlsx';
    }

    function save(project, result, hyd) {
        return build(project, result, hyd).then(function (bytes) {
            Zip.save(bytes, fileName(project, hyd), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            return bytes;
        });
    }

    return { data: data, groupItps: groupItps, build: build, save: save, heat: heat, fmtElev: fmtElev, fileName: fileName };
})();
